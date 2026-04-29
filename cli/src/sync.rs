//! CLI-side sync runtime.
//!
//! `Session` is the per-invocation handle: open at command start, mutate
//! the local Loro doc, `flush()` at end. Open does the WS handshake and
//! initial pull; flush saves `loro.bin`, pushes any pending ops, and
//! advances the device's `last_acked_op_id`.
//!
//! Offline behavior matches `spec/cli.md`:
//! - Default: 2s connect timeout. Failure → local-only with a stderr
//!   warning. Pending ops live in `loro.bin` and ship on the next
//!   online invocation.
//! - `--offline` / `AIRDAY_OFFLINE=1` skip the connect attempt entirely.

use std::time::Duration;

use airday_core::{Dek, Doc};
use airday_protocol::{
    ClientFrame, Hello, HelloAck, HelloRejected, ServerFrame, StoredOp, PROTOCOL_VERSION,
};
use futures_util::{SinkExt, StreamExt};
use http::header::AUTHORIZATION;
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::config::{ConfigError, DeviceConfig, Profile};
use crate::keystore::{dek_from_hex, KeystoreError};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error(transparent)]
    Keystore(#[from] KeystoreError),
    #[error(transparent)]
    Doc(#[from] airday_core::DocError),
    #[error("ws: {0}")]
    Ws(String),
    #[error("encode: {0}")]
    Encode(#[from] rmp_serde::encode::Error),
    #[error("decode: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
    #[error("server rejected handshake: {0}")]
    HandshakeRejected(String),
    #[error("unexpected server frame: {0}")]
    UnexpectedFrame(String),
}

impl From<tokio_tungstenite::tungstenite::Error> for SyncError {
    fn from(e: tokio_tungstenite::tungstenite::Error) -> Self {
        SyncError::Ws(e.to_string())
    }
}

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// One-shot per-command sync handle.
pub struct Session {
    profile: Profile,
    device: DeviceConfig,
    dek: Dek,
    pub doc: Doc,
    ws: Option<WsStream>,
    /// Highest op id we know about — bumped by pull and by our own
    /// pushes' assigned ids. Acked once on flush.
    highest_seen_op_id: u64,
}

impl Session {
    /// Load profile + secrets + doc, optionally connect and run the
    /// initial pull. Falls back to offline (with a stderr warning) if
    /// the connect attempt fails or times out.
    pub async fn open(offline: bool) -> Result<Self, SyncError> {
        let profile = Profile::require_active()?;
        Self::open_with_profile(profile, offline).await
    }

    /// As `open`, but takes an explicit profile. Used by tests that
    /// need to point the runtime at a tempdir without mutating
    /// process-global state (env vars, the `active` symlink).
    pub async fn open_with_profile(profile: Profile, offline: bool) -> Result<Self, SyncError> {
        let device = profile.read_device()?;
        let secrets = profile.read_secrets()?;
        let dek = dek_from_hex(&secrets.dek_hex)?;
        let doc = match profile.read_doc() {
            Ok(d) => d,
            Err(ConfigError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {
                // First-run shouldn't hit this — signup writes the doc —
                // but a partially-set-up profile (e.g. from a debug
                // build that predates this slice) heals into an empty
                // doc rather than crashing the next subcommand.
                Doc::empty()
            }
            Err(e) => return Err(e.into()),
        };
        let highest_seen_op_id = device.last_acked_op_id;

        let mut session = Session {
            profile,
            device,
            dek,
            doc,
            ws: None,
            highest_seen_op_id,
        };

        if offline_requested(offline) {
            return Ok(session);
        }

        match session.try_connect_and_pull().await {
            Ok(()) => Ok(session),
            Err(e) => {
                eprintln!("offline — sync deferred ({e})");
                session.ws = None;
                Ok(session)
            }
        }
    }

    pub fn is_online(&self) -> bool {
        self.ws.is_some()
    }

    /// Persist the doc, push any pending ops, ack the frontier, close
    /// the socket. Local persistence runs first so a network failure
    /// after a mutation can't silently drop the change.
    pub async fn flush(mut self) -> Result<(), SyncError> {
        self.profile.write_doc(&self.doc)?;

        if let Some(ws) = self.ws.as_mut() {
            if let Some(blob) = self.doc.pending_export(&self.dek)? {
                send_frame(ws, &ClientFrame::PushOps { ops: vec![blob] }).await?;
                let resp: ServerFrame = recv_frame(ws).await?;
                let assigned = match resp {
                    ServerFrame::OpsAck { assigned_ids } => assigned_ids,
                    other => {
                        return Err(SyncError::UnexpectedFrame(format!("{other:?}")));
                    }
                };
                if let Some(top) = assigned.iter().copied().max() {
                    self.highest_seen_op_id = self.highest_seen_op_id.max(top);
                }
                self.doc.mark_pushed();
                // Re-save with the advanced last_pushed_vv so a crash
                // between push and ack doesn't re-export the same ops.
                self.profile.write_doc(&self.doc)?;
            }

            if self.highest_seen_op_id > self.device.last_acked_op_id {
                send_frame(
                    ws,
                    &ClientFrame::Ack {
                        last_acked_op_id: self.highest_seen_op_id,
                    },
                )
                .await?;
                self.device.last_acked_op_id = self.highest_seen_op_id;
                self.profile.write_device(&self.device)?;
            }

            // Best-effort close — server will disconnect on its own
            // if the close frame is lost.
            let _ = ws.close(None).await;

            self.device.last_sync_at = Some(now_millis());
            self.profile.write_device(&self.device)?;
        }
        Ok(())
    }

    async fn try_connect_and_pull(&mut self) -> Result<(), SyncError> {
        let mut ws = tokio::time::timeout(CONNECT_TIMEOUT, self.connect()).await
            .map_err(|_| SyncError::Ws(format!("connect timed out after {CONNECT_TIMEOUT:?}")))??;
        self.handshake(&mut ws).await?;
        self.pull_initial(&mut ws).await?;
        self.ws = Some(ws);
        Ok(())
    }

    async fn connect(&self) -> Result<WsStream, SyncError> {
        let url = ws_url(&self.device.server_url);
        let mut req = url
            .into_client_request()
            .map_err(|e| SyncError::Ws(e.to_string()))?;
        let secrets = self.profile.read_secrets()?;
        req.headers_mut().insert(
            AUTHORIZATION,
            format!("Bearer {}", secrets.device_token)
                .parse()
                .map_err(|_| SyncError::Ws("invalid bearer header".into()))?,
        );
        let (ws, _) = tokio_tungstenite::connect_async(req).await?;
        Ok(ws)
    }

    async fn handshake(&self, ws: &mut WsStream) -> Result<(), SyncError> {
        send_frame(
            ws,
            &Hello {
                client: "airday-cli".into(),
                client_version: env!("CARGO_PKG_VERSION").into(),
                supported_protocol_versions: vec![PROTOCOL_VERSION],
            },
        )
        .await?;
        // Server sends either HelloAck or HelloRejected — both decode
        // from the same envelope; peek at the bytes once and try each.
        let bytes = recv_bytes(ws).await?;
        if let Ok(ack) = rmp_serde::from_slice::<HelloAck>(&bytes) {
            if ack.protocol_version != PROTOCOL_VERSION {
                return Err(SyncError::HandshakeRejected(format!(
                    "server picked protocol {} but client speaks {PROTOCOL_VERSION}",
                    ack.protocol_version
                )));
            }
            return Ok(());
        }
        if let Ok(rej) = rmp_serde::from_slice::<HelloRejected>(&bytes) {
            return Err(SyncError::HandshakeRejected(rej.reason));
        }
        Err(SyncError::UnexpectedFrame(
            "first server frame was neither HelloAck nor HelloRejected".into(),
        ))
    }

    async fn pull_initial(&mut self, ws: &mut WsStream) -> Result<(), SyncError> {
        send_frame(
            ws,
            &ClientFrame::PullOps {
                since_op_id: self.device.last_acked_op_id,
            },
        )
        .await?;
        loop {
            let frame: ServerFrame = recv_frame(ws).await?;
            match frame {
                ServerFrame::OpsBatch { ops, complete } => {
                    self.apply_batch(ops)?;
                    if complete {
                        return Ok(());
                    }
                }
                // Broadcast frames may arrive interleaved with the
                // pull stream if peers are pushing right now — apply
                // and keep waiting for the pull's terminating batch.
                ServerFrame::OpsBroadcast { ops } => {
                    self.apply_batch(ops)?;
                }
                other => {
                    return Err(SyncError::UnexpectedFrame(format!("{other:?}")));
                }
            }
        }
    }

    fn apply_batch(&mut self, ops: Vec<StoredOp>) -> Result<(), SyncError> {
        for op in ops {
            self.doc.apply_remote(&self.dek, &op.blob)?;
            self.highest_seen_op_id = self.highest_seen_op_id.max(op.id);
        }
        Ok(())
    }
}

fn offline_requested(flag: bool) -> bool {
    flag || std::env::var("AIRDAY_OFFLINE").map(|v| v != "0" && !v.is_empty()).unwrap_or(false)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn ws_url(server_url: &str) -> String {
    let trimmed = server_url.trim_end_matches('/');
    let base = if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        trimmed.to_string()
    };
    format!("{base}/api/sync")
}

async fn send_frame<T: Serialize>(ws: &mut WsStream, value: &T) -> Result<(), SyncError> {
    let bytes = rmp_serde::to_vec_named(value)?;
    ws.send(Message::Binary(bytes)).await?;
    Ok(())
}

async fn recv_frame<T: DeserializeOwned>(ws: &mut WsStream) -> Result<T, SyncError> {
    let bytes = recv_bytes(ws).await?;
    Ok(rmp_serde::from_slice(&bytes)?)
}

async fn recv_bytes(ws: &mut WsStream) -> Result<Vec<u8>, SyncError> {
    loop {
        let msg = ws
            .next()
            .await
            .ok_or_else(|| SyncError::Ws("stream closed".into()))??;
        match msg {
            Message::Binary(bytes) => return Ok(bytes.to_vec()),
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Close(_) => return Err(SyncError::Ws("server closed".into())),
            other => {
                return Err(SyncError::Ws(format!("unexpected ws frame: {other:?}")));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_url_strips_http_scheme() {
        assert_eq!(ws_url("http://localhost:8080"), "ws://localhost:8080/api/sync");
        assert_eq!(ws_url("https://airday.example/"), "wss://airday.example/api/sync");
        assert_eq!(ws_url("ws://localhost:9000"), "ws://localhost:9000/api/sync");
    }

    #[test]
    fn offline_env_var_honoured() {
        // SAFETY: tests run single-threaded under #[test] within this
        // module; no other test reads/writes AIRDAY_OFFLINE.
        std::env::set_var("AIRDAY_OFFLINE", "1");
        assert!(offline_requested(false));
        std::env::set_var("AIRDAY_OFFLINE", "0");
        assert!(!offline_requested(false));
        std::env::remove_var("AIRDAY_OFFLINE");
        assert!(!offline_requested(false));
        assert!(offline_requested(true));
    }
}
