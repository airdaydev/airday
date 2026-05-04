//! WebSocket sync endpoint: handshake → push / pull / ack loop with
//! peer broadcast on push.
//!
//! Auth happens on the upgrade via the same bearer extractor used by
//! HTTP routes — token validation runs *before* the upgrade response
//! goes out, so an unauthorized client never gets a socket.
//!
//! Snapshot frames are part of the wire types but intentionally not
//! handled here yet.

use airday_protocol::{
    ClientFrame, EncryptedBlob, Hello, HelloAck, HelloRejected, ServerFrame, StoredOp,
    PROTOCOL_VERSION,
};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, Query, State};
use axum::http::HeaderMap;
use axum::response::Response;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tracing::Instrument;
use uuid::Uuid;

use crate::auth::cookie;
use crate::auth::queries::{find_device_by_token_hash, touch_device_last_seen};
use crate::auth::tokens::{decode_token, sha256};
use crate::auth::DeviceAuth;
use crate::error::ApiError;
use crate::http::request_id::RequestId;
use crate::state::AppState;

use super::queries;

/// Server's reported version on `HelloAck`. Bumped manually for now;
/// when there's a build-info crate we'll plumb `CARGO_PKG_VERSION`.
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// `?token=...` is a non-browser fallback (e.g. test clients that can't
/// set headers on WS upgrades). Browsers use the `airday_device` cookie,
/// which the user-agent attaches to the upgrade request automatically;
/// CLI uses the `Authorization` header.
#[derive(Deserialize)]
pub struct WsAuthQuery {
    token: Option<String>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(q): Query<WsAuthQuery>,
    headers: HeaderMap,
    Extension(request_id): Extension<RequestId>,
) -> Result<Response, ApiError> {
    // Preference order: bearer header (CLI) → cookie (web) → query param
    // (test fallback). All three reach the same hash lookup.
    let bearer = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(str::to_owned);
    let cookie_token = cookie::token_from_cookies(&headers).map(str::to_owned);
    let raw_hex = bearer
        .or(cookie_token)
        .or(q.token)
        .ok_or(ApiError::Unauthorized)?;
    let raw = decode_token(&raw_hex).ok_or(ApiError::Unauthorized)?;
    let hash = sha256(&raw).to_vec();
    let lookup = find_device_by_token_hash(&state.db, hash)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let _ = touch_device_last_seen(&state.db, lookup.device_id).await;
    let auth = DeviceAuth {
        account_id: lookup.account_id,
        device_id: lookup.device_id,
    };
    let session_id = Uuid::now_v7().to_string();
    let upgrade_request_id = request_id.0;
    Ok(ws.on_upgrade(move |socket| async move {
        let span = tracing::info_span!(
            "ws.session",
            session_id = %session_id,
            upgrade_request_id = %upgrade_request_id,
            account_id = %auth.account_id,
            device_id = %auth.device_id,
        );
        async move {
            tracing::info!("ws session started");
            match run_session(socket, state, auth).await {
                Ok(()) => tracing::info!("ws session closed"),
                Err(SessionError::Closed) => tracing::info!("ws session closed"),
                Err(e) => tracing::warn!(error = %e, "ws session ended with error"),
            }
        }
        .instrument(span)
        .await
    }))
}

#[derive(Debug, thiserror::Error)]
enum SessionError {
    #[error("connection closed")]
    Closed,
    #[error("ws error: {0}")]
    Ws(#[from] axum::Error),
    #[error("expected binary frame, got text")]
    UnexpectedTextFrame,
    #[error("decode: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
    #[error("encode: {0}")]
    Encode(#[from] rmp_serde::encode::Error),
    #[error(transparent)]
    Sql(#[from] anyhow::Error),
    #[error("handshake failed: {0}")]
    Handshake(String),
    #[error("broadcast channel dropped — slow client")]
    BroadcastLagged,
}

async fn run_session(
    mut socket: WebSocket,
    state: AppState,
    auth: DeviceAuth,
) -> Result<(), SessionError> {
    let handshake_span = tracing::info_span!("ws.handshake");
    let _hello: Hello = async {
        let hello: Hello = recv_msgpack(&mut socket).await?;
        if !hello
            .supported_protocol_versions
            .contains(&PROTOCOL_VERSION)
        {
            let _ = send_msgpack(
                &mut socket,
                &HelloRejected {
                    reason: format!("no shared protocol version (server speaks {PROTOCOL_VERSION})"),
                },
            )
            .await;
            tracing::warn!(
                offered_versions = ?hello.supported_protocol_versions,
                protocol_version = PROTOCOL_VERSION,
                "ws handshake rejected"
            );
            return Err(SessionError::Handshake(format!(
                "client offered {:?}, server speaks {}",
                hello.supported_protocol_versions, PROTOCOL_VERSION
            )));
        }
        send_msgpack(
            &mut socket,
            &HelloAck {
                server_version: SERVER_VERSION.into(),
                protocol_version: PROTOCOL_VERSION,
            },
        )
        .await?;
        tracing::info!(protocol_version = PROTOCOL_VERSION, "ws handshake accepted");
        Ok(hello)
    }
    .instrument(handshake_span)
    .await?;

    // Subscribe *after* a successful handshake so we never deliver
    // peer broadcasts to a session that hasn't agreed on the protocol
    // version. Subscription is RAII — dropping deregisters.
    let mut sub = state.sync_sessions.subscribe(auth.account_id);

    let sub_id = sub.sub_id();
    loop {
        tokio::select! {
            client_frame = recv_msgpack::<ClientFrame>(&mut socket) => {
                match client_frame {
                    Ok(frame) => handle_frame(&mut socket, &state, &auth, sub_id, frame).await?,
                    Err(SessionError::Closed) => return Ok(()),
                    Err(e) => return Err(e),
                }
            }
            broadcast = sub.rx.recv() => {
                let bytes = broadcast.ok_or(SessionError::BroadcastLagged)?;
                let broadcast_span = tracing::info_span!(
                    "ws.broadcast_send",
                    message_bytes = bytes.len()
                );
                socket.send(Message::Binary(bytes.into())).await?;
                tracing::debug!(parent: &broadcast_span, "ws broadcast delivered");
            }
        }
    }
}

async fn handle_frame(
    socket: &mut WebSocket,
    state: &AppState,
    auth: &DeviceAuth,
    sub_id: u64,
    frame: ClientFrame,
) -> Result<(), SessionError> {
    match frame {
        ClientFrame::PushOps { ops } => push_ops(socket, state, auth, sub_id, ops).await,
        ClientFrame::PullOps { since_op_id } => pull_ops(socket, state, auth, since_op_id).await,
        ClientFrame::Ack { last_acked_op_id } => {
            let ack_span = tracing::info_span!(
                "ws.ack",
                last_acked_op_id = last_acked_op_id
            );
            queries::advance_last_acked_op_id(&state.db, auth.device_id, last_acked_op_id).await?;
            tracing::debug!(parent: &ack_span, "ws ack applied");
            Ok(())
        }
        // Snapshot frames are reserved — log and continue rather than
        // tearing down the session, so a client that probes them
        // doesn't lose its push/pull progress.
        ClientFrame::PushSnapshot { .. } | ClientFrame::PullSnapshot => {
            tracing::warn!("snapshot frames not yet implemented; ignoring");
            Ok(())
        }
    }
}

async fn push_ops(
    socket: &mut WebSocket,
    state: &AppState,
    auth: &DeviceAuth,
    sub_id: u64,
    ops: Vec<EncryptedBlob>,
) -> Result<(), SessionError> {
    let push_span = tracing::info_span!("ws.push_ops", op_count = ops.len());
    if ops.is_empty() {
        return async {
            tracing::debug!("ws push_ops empty");
            send_msgpack(
                socket,
                &ServerFrame::OpsAck {
                    assigned_ids: Vec::new(),
                },
            )
            .await
        }
        .instrument(push_span)
        .await;
    }

    async {
        let blobs_for_broadcast = ops.clone();
        let assigned_ids =
            queries::insert_ops(&state.db, auth.account_id, ops).await?;

        // Post-commit fan-out, before acking the originator. Both branches
        // are correct (the originator's ack and peer broadcasts are
        // independent), but queueing first means peers don't race the
        // originator's "I'm done pushing" signal.
        let stored: Vec<StoredOp> = assigned_ids
            .iter()
            .copied()
            .zip(blobs_for_broadcast)
            .map(|(id, blob)| StoredOp { id, blob })
            .collect();
        state
            .sync_sessions
            .broadcast(auth.account_id, sub_id, stored);

        tracing::info!(
            assigned_id_count = assigned_ids.len(),
            first_assigned_op_id = assigned_ids.first().copied(),
            last_assigned_op_id = assigned_ids.last().copied(),
            "ws push_ops persisted"
        );

        send_msgpack(socket, &ServerFrame::OpsAck { assigned_ids }).await
    }
    .instrument(push_span)
    .await
}

async fn pull_ops(
    socket: &mut WebSocket,
    state: &AppState,
    auth: &DeviceAuth,
    since_op_id: u64,
) -> Result<(), SessionError> {
    let pull_span = tracing::info_span!("ws.pull_ops", since_op_id = since_op_id);
    // Drain in sub-batches until exhaustion. The final batch — including
    // the trivially-empty case — carries `complete = true` so the client
    // can deterministically end its pull regardless of how many chunks
    // it took.
    async {
        let mut cursor = since_op_id;
        let mut batch_count = 0u64;
        let mut total_ops = 0usize;
        loop {
            let batch = queries::fetch_ops_batch(&state.db, auth.account_id, cursor).await?;
            let batch_len = batch.ops.len();
            let next_cursor = batch.ops.last().map(|o| o.id).unwrap_or(cursor);
            let complete = !batch.has_more;
            send_msgpack(
                socket,
                &ServerFrame::OpsBatch {
                    ops: batch.ops,
                    complete,
                },
            )
            .await?;
            batch_count += 1;
            total_ops += batch_len;
            if complete {
                tracing::info!(
                    batch_count = batch_count,
                    op_count = total_ops,
                    final_op_id = next_cursor,
                    "ws pull_ops completed"
                );
                return Ok(());
            }
            cursor = next_cursor;
        }
    }
    .instrument(pull_span)
    .await
}

async fn recv_msgpack<T: DeserializeOwned>(socket: &mut WebSocket) -> Result<T, SessionError> {
    loop {
        let msg = socket
            .recv()
            .await
            .ok_or(SessionError::Closed)?
            .map_err(SessionError::Ws)?;
        return match msg {
            Message::Binary(bytes) => Ok(rmp_serde::from_slice(&bytes)?),
            Message::Close(_) => Err(SessionError::Closed),
            // Pings are answered by axum transparently; we just keep
            // looping until a payload arrives.
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Text(_) => Err(SessionError::UnexpectedTextFrame),
        };
    }
}

async fn send_msgpack<T: Serialize>(socket: &mut WebSocket, value: &T) -> Result<(), SessionError> {
    let bytes = rmp_serde::to_vec_named(value)?;
    socket.send(Message::Binary(bytes.into())).await?;
    Ok(())
}
