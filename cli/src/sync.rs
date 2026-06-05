//! CLI-side sync runtime — a thin tokio-tungstenite adapter that
//! drives the sans-IO `airday_core::SyncEngine`.
//!
//! `Session` is the per-invocation handle: open at command start, mutate
//! the local Loro doc via `session.doc()`, `flush()` at end. With sync
//! requested, open does the WS handshake and initial pull through the
//! engine; flush saves the doc snapshot, asks the engine to push
//! pending ops, advances the per-doc sync cursor in sqlite.
//!
//! Offline-by-default per `spec/cli.md`:
//! - Default: no network. Mutations are persisted locally and ship on
//!   the next sync invocation.
//! - `--sync` / `-s` / `AIRDAY_SYNC=1`: attempt WS connect with a 2s
//!   timeout. Failure → local-only with a stderr warning. The dedicated
//!   `airday sync` command treats connect failure as a hard error.

use std::time::Duration;

use airday_core::{Doc, DocId, EngineOptions, Event, ServerSeq, SyncEngine};
use futures_util::{SinkExt, StreamExt};
use http::header::AUTHORIZATION;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::config::{ConfigError, Profile};
use crate::keystore::{dek_from_hex, KeystoreError};
use crate::storage::{SqliteStorage, SyncCursor};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error(transparent)]
    Keystore(#[from] KeystoreError),
    #[error(transparent)]
    Doc(#[from] airday_core::DocError),
    #[error(transparent)]
    StorageInit(#[from] crate::storage::StorageInitError),
    #[error("storage: {0}")]
    Storage(#[from] airday_core::StorageError),
    #[error("ws: {0}")]
    Ws(String),
    #[error("engine: {0}")]
    Engine(String),
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
    server_url: String,
    doc_id: DocId,
    /// Handle for persisting the sync cursor. A clone of the storage the
    /// engine owns — same underlying connection (see `SqliteStorage`'s
    /// `Clone`) — since the engine's handle is boxed behind `dyn
    /// LocalStorage` and its inherent cursor methods aren't reachable
    /// through it.
    store: SqliteStorage,
    last_acked: u64,
    last_sync_at: Option<i64>,
    engine: SyncEngine,
    ws: Option<WsStream>,
}

impl Session {
    /// Load profile + secrets + doc; if `sync` is true, connect and
    /// run the initial pull. Falls back to local-only (with a stderr
    /// warning) when the connect attempt fails or times out.
    pub async fn open(sync: bool) -> Result<Self, SyncError> {
        let profile = Profile::require_active()?;
        Self::open_with_profile(profile, sync).await
    }

    /// As `open`, but takes an explicit profile. Used by tests that
    /// need to point the runtime at a tempdir without mutating
    /// process-global state (the `AIRDAY_DATA_DIR` env var).
    pub async fn open_with_profile(profile: Profile, sync: bool) -> Result<Self, SyncError> {
        let config = profile.read_config()?;
        let secrets = profile.read_secrets()?;
        let dek = dek_from_hex(&secrets.dek_hex)?;
        // Boot the doc from the op log + snapshot. A fresh profile (no
        // snapshot yet) reconstructs an empty doc — the same healing
        // behaviour the old file-based `read_doc` NotFound branch had.
        let storage = crate::storage::open_storage(&profile)?;
        let account = storage.read_account()?;
        let doc_id = account.primary_doc_id;
        let (doc, last_local) = crate::storage::boot_doc(&storage, &dek, doc_id)?;
        let cursor = storage.read_sync_cursor(doc_id)?;
        // `store` and the engine's storage are clones sharing one
        // connection (see `SqliteStorage`'s `Clone`), so `Session` can
        // persist the cursor while the engine owns its handle.
        let store = storage.clone();

        let mut engine = SyncEngine::new(
            doc,
            doc_id,
            dek,
            cursor.last_acked_server_seq.0,
            EngineOptions {
                client_name: "airday-cli".into(),
                client_version: env!("CARGO_PKG_VERSION").into(),
            },
            Box::new(storage),
        );
        engine.set_last_local_seq(last_local);

        let mut session = Session {
            profile,
            server_url: config.server_url,
            doc_id,
            store,
            last_acked: cursor.last_acked_server_seq.0,
            last_sync_at: cursor.last_sync_at,
            engine,
            ws: None,
        };

        if !sync_requested(sync) {
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

    /// Borrow the local doc — commands read and mutate via this. Doc's
    /// own methods take `&self` (loro uses interior mutability) so a
    /// shared reference is enough for both reads and writes.
    pub fn doc(&self) -> &Doc {
        self.engine.doc()
    }

    /// Drive any inbound frames already waiting on the live socket,
    /// then return once the connection has been quiet for `quiet_for`.
    /// Useful for long-lived tests that need to keep servicing
    /// broadcasts or `SnapshotRequest`s between local mutations.
    pub async fn pump_until_quiet(&mut self, quiet_for: Duration) -> Result<usize, SyncError> {
        let Some(mut ws) = self.ws.take() else {
            return Ok(0);
        };
        let result = async {
            let mut processed = 0usize;
            loop {
                let bytes = match recv_bytes_timeout(&mut ws, quiet_for).await? {
                    Some(bytes) => bytes,
                    None => break,
                };
                processed += 1;
                self.engine.handle_server_bytes(&bytes, monotonic_ms());
                // Drive the gap-retry tick after every server frame
                // too — if a hole just opened, this gives the timer a
                // chance to fire as soon as backoff elapses without
                // waiting for a separate polling loop.
                self.engine.handle_timeout(monotonic_ms());
                // Persist before flushing the outbox — the engine
                // doesn't queue Acks for newly-applied ops until
                // `persist_engine_state` calls `notify_wal_durable`.
                // This binds every outbound Ack to a doc write
                // already on disk.
                self.persist_engine_state().await?;
                send_outbox(&mut ws, &mut self.engine).await?;
                drain_engine_errors(&mut self.engine)?;
                if !self.engine.is_online() {
                    return Err(SyncError::Engine("engine disconnected mid-pump".into()));
                }
                // Each processed frame is a confirmed online exchange.
                self.mark_synced()?;
            }
            Ok(processed)
        }
        .await;
        self.ws = Some(ws);
        result
    }

    /// Persist the doc, push any pending ops, ack the frontier, close
    /// the socket. Local persistence runs first so a network failure
    /// after a mutation can't silently drop the change.
    pub async fn flush(mut self) -> Result<(), SyncError> {
        self.persist_engine_state().await?;

        if let Some(mut ws) = self.ws.take() {
            self.engine.flush();
            drive_until_idle(&mut ws, &mut self.engine).await?;
            // `drive_until_idle` returned with the engine Idle. Any
            // server frame applied during the drive advanced the
            // engine's in-memory frontier but **did not** queue an
            // Ack (gated on `notify_wal_durable`). Persist now —
            // that writes the doc and calls `notify_wal_durable`,
            // which queues the Ack — then flush the outbox before
            // closing so the ack actually leaves the wire.
            self.persist_engine_state().await?;
            send_outbox(&mut ws, &mut self.engine).await?;

            // Best-effort close — server will disconnect on its own
            // if the close frame is lost.
            let _ = ws.close(None).await;

            // We completed an online push/pull/ack exchange — record it.
            self.mark_synced()?;
        }
        Ok(())
    }

    async fn try_connect_and_pull(&mut self) -> Result<(), SyncError> {
        let mut ws = tokio::time::timeout(CONNECT_TIMEOUT, self.connect())
            .await
            .map_err(|_| SyncError::Ws(format!("connect timed out after {CONNECT_TIMEOUT:?}")))??;
        self.engine.handle_connected();
        drive_until_idle(&mut ws, &mut self.engine).await?;
        self.ws = Some(ws);
        Ok(())
    }

    async fn connect(&self) -> Result<WsStream, SyncError> {
        let url = ws_url(&self.server_url);
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

    async fn persist_engine_state(&mut self) -> Result<(), SyncError> {
        // Capture any locally-committed mutations into a durable op-log
        // row first — this is what `try_start_push` ships, and it's on
        // disk before any Ack leaves the wire. Then compact: once every
        // captured op is acked (outbox empty), fold the log into a fresh
        // snapshot. `SqliteStorage` is synchronously durable, so by the
        // time these return every applied seq is on disk and we can tell
        // the engine "everything up to `last_contiguous_seq` is durable"
        // — which advances the durable cursor and queues an Ack. Callers
        // needing the ack on the wire (`flush`) must `send_outbox` next.
        self.engine.capture_local_ops()?;
        self.engine.snapshot_if_fully_synced()?;
        let contiguous = self.engine.last_contiguous_seq();
        self.engine.notify_wal_durable(contiguous);
        let acked = self.engine.last_durable_seq();
        if acked > self.last_acked {
            self.last_acked = acked;
        }
        // Persist the cursor on every flush — local-only included, since
        // an offline mutation still advances it. `last_sync_at` is *not*
        // touched here: it means "last successful online sync", and this
        // path runs even when offline (`flush` calls it unconditionally,
        // and every command — even read-only `ls` — flushes). It's
        // stamped only by `mark_synced`, on a confirmed online exchange.
        self.store.write_sync_cursor(
            self.doc_id,
            SyncCursor {
                last_acked_server_seq: ServerSeq(self.last_acked),
                last_sync_at: self.last_sync_at,
            },
        )?;
        Ok(())
    }

    /// Stamp "last successful online sync" = now and persist it. Called
    /// only after a confirmed online exchange — never on an offline or
    /// purely local flush — so `airday status` reports when this device
    /// actually last reached the server, not when it last ran a command.
    fn mark_synced(&mut self) -> Result<(), SyncError> {
        self.last_sync_at = Some(now_millis());
        self.store.write_sync_cursor(
            self.doc_id,
            SyncCursor {
                last_acked_server_seq: ServerSeq(self.last_acked),
                last_sync_at: self.last_sync_at,
            },
        )?;
        Ok(())
    }
}

/// Shuffle bytes between the WS and the engine until the engine
/// reports `Idle`. Drains the outbox after every step so a stalled
/// engine can't sit on a frame the server is waiting for.
///
/// Engine `Error` events become `SyncError::Engine` — they're how the
/// engine surfaces handshake rejection and frame-decode failures.
async fn drive_until_idle(ws: &mut WsStream, engine: &mut SyncEngine) -> Result<(), SyncError> {
    loop {
        send_outbox(ws, engine).await?;
        drain_engine_errors(engine)?;
        if !engine.is_online() {
            return Err(SyncError::Engine("engine disconnected mid-drive".into()));
        }
        if engine.is_idle() {
            // One last sweep: handling earlier bytes might have queued
            // an Ack that hasn't been flushed yet.
            send_outbox(ws, engine).await?;
            return Ok(());
        }
        let bytes = recv_bytes(ws).await?;
        engine.handle_server_bytes(&bytes, monotonic_ms());
    }
}

async fn send_outbox(ws: &mut WsStream, engine: &mut SyncEngine) -> Result<(), SyncError> {
    while let Some(bytes) = engine.pop_outbox() {
        ws.send(Message::Binary(bytes)).await?;
    }
    Ok(())
}

fn drain_engine_errors(engine: &mut SyncEngine) -> Result<(), SyncError> {
    for event in drain_events(engine) {
        if let Event::Error(msg) = event {
            return Err(SyncError::Engine(msg));
        }
    }
    Ok(())
}

fn drain_events(engine: &mut SyncEngine) -> Vec<Event> {
    let mut out = Vec::new();
    while let Some(ev) = engine.pop_event() {
        out.push(ev);
    }
    out
}

fn sync_requested(flag: bool) -> bool {
    flag || std::env::var("AIRDAY_SYNC")
        .map(|v| v != "0" && !v.is_empty())
        .unwrap_or(false)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Monotonic millis since the process started. Fed to the engine's
/// `handle_*` methods that need a clock — the engine itself is
/// time-free. Wall-clock skew is irrelevant; we only need
/// non-decreasing deltas for the gap-retry timer.
fn monotonic_ms() -> u64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    let epoch = EPOCH.get_or_init(Instant::now);
    epoch.elapsed().as_millis() as u64
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

async fn recv_bytes_timeout(
    ws: &mut WsStream,
    timeout: Duration,
) -> Result<Option<Vec<u8>>, SyncError> {
    loop {
        let next = tokio::time::timeout(timeout, ws.next()).await;
        let Some(msg) = (match next {
            Ok(msg) => msg,
            Err(_) => return Ok(None),
        }) else {
            return Err(SyncError::Ws("stream closed".into()));
        };
        match msg? {
            Message::Binary(bytes) => return Ok(Some(bytes.to_vec())),
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Close(_) => return Err(SyncError::Ws("server closed".into())),
            other => return Err(SyncError::Ws(format!("unexpected ws frame: {other:?}"))),
        }
    }
}

async fn recv_bytes(ws: &mut WsStream) -> Result<Vec<u8>, SyncError> {
    loop {
        if let Some(bytes) = recv_bytes_timeout(ws, Duration::from_secs(365 * 24 * 60 * 60)).await?
        {
            return Ok(bytes);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_url_strips_http_scheme() {
        assert_eq!(
            ws_url("http://localhost:8080"),
            "ws://localhost:8080/api/sync"
        );
        assert_eq!(
            ws_url("https://airday.example/"),
            "wss://airday.example/api/sync"
        );
        assert_eq!(
            ws_url("ws://localhost:9000"),
            "ws://localhost:9000/api/sync"
        );
    }

    #[test]
    fn sync_env_var_honoured() {
        // SAFETY: tests run single-threaded under #[test] within this
        // module; no other test reads/writes AIRDAY_SYNC.
        std::env::set_var("AIRDAY_SYNC", "1");
        assert!(sync_requested(false));
        std::env::set_var("AIRDAY_SYNC", "0");
        assert!(!sync_requested(false));
        std::env::remove_var("AIRDAY_SYNC");
        assert!(!sync_requested(false));
        assert!(sync_requested(true));
    }
}
