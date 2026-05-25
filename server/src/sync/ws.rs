//! WebSocket sync endpoint: handshake → push / pull / ack loop with
//! peer broadcast on push.
//!
//! Auth happens on the upgrade via the same bearer extractor used by
//! HTTP routes — token validation runs *before* the upgrade response
//! goes out, so an unauthorized client never gets a socket.
//!
use std::time::Instant;

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
use crate::sync::snapshot::{Decision, ReleaseResult};

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

struct WSSession {
    auth: DeviceAuth,
    sub_id: u64,
    snapshot_lease: Option<u64>,
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
                    reason: format!(
                        "no shared protocol version (server speaks {PROTOCOL_VERSION})"
                    ),
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
    let mut sub = state
        .sync_sessions
        .subscribe(auth.account_id, auth.device_id);

    let sub_id = sub.sub_id();

    let mut ws_session = WSSession {
        auth,
        sub_id,
        snapshot_lease: None,
    };

    let result = loop {
        tokio::select! {
            client_frame = recv_msgpack::<ClientFrame>(&mut socket) => {
                match client_frame {
                    Ok(frame) => handle_frame(&mut socket, &state, &mut ws_session, frame).await?,
                    Err(SessionError::Closed) => break Ok(()),
                    Err(e) => break Err(e),
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
    };
    drop(sub);
    if let Some(lease_id) = ws_session.snapshot_lease.take() {
        state
            .snapshot_coordinator_2
            .release(ws_session.auth.account_id, lease_id);
    }
    result
}

async fn handle_frame(
    socket: &mut WebSocket,
    state: &AppState,
    ws_session: &mut WSSession,
    frame: ClientFrame,
) -> Result<(), SessionError> {
    match frame {
        ClientFrame::PushOps { ops } => push_ops(socket, state, &ws_session, ops).await,
        ClientFrame::PullOps { since_op_id } => {
            pull_ops(socket, state, &ws_session.auth, since_op_id).await
        }
        ClientFrame::Ack { last_acked_op_id } => {
            let ack_span = tracing::info_span!("ws.ack", last_acked_op_id = last_acked_op_id);
            queries::advance_last_acked_op_id(
                &state.db,
                ws_session.auth.device_id,
                last_acked_op_id,
            )
            .await?;
            tracing::debug!(parent: &ack_span, "ws ack applied");
            Ok(())
        }
        ClientFrame::PullSnapshot => pull_snapshot(socket, state, &ws_session.auth).await,
        ClientFrame::PushSnapshot { up_to_op_id, blob } => {
            push_snapshot(state, ws_session, up_to_op_id, blob).await
        }
    }
}

async fn push_ops(
    socket: &mut WebSocket,
    state: &AppState,
    ws_session: &WSSession,
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
        let assigned_ids = queries::insert_ops(&state.db, ws_session.auth.account_id, ops).await?;

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
            .broadcast(ws_session.auth.account_id, ws_session.sub_id, stored);

        tracing::info!(
            assigned_id_count = assigned_ids.len(),
            first_assigned_op_id = assigned_ids.first().copied(),
            last_assigned_op_id = assigned_ids.last().copied(),
            "ws push_ops persisted"
        );

        if let Some(latest_op_id) = assigned_ids.last().copied() {
            let server_snapshot_op_id =
                queries::latest_snapshot_floor(&state.db, ws_session.auth.account_id)
                    .await?
                    .unwrap_or(0);
            let decision = state.snapshot_coordinator_2.evaluate(
                ws_session.auth.account_id,
                server_snapshot_op_id,
                0, // TODO: Where we get this from?
                latest_op_id,
                Instant::now(),
            );
            if let Decision::Issue {
                lease_id,
                up_to_op_id,
            } = decision
            {
                // TODO: Push snapshot req message out
            };
        }

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
    // Bootstrap-from-snapshot precondition: if the latest snapshot's
    // `up_to_op_id` is ahead of the client's cursor, the client cannot
    // resume from ops alone (compacted ops below the floor are gone,
    // and even when they aren't, replaying every op since 0 wastes
    // round trips). Hand back `SnapshotRequired` and let the client
    // drive the bootstrap exchange.
    async {
        if let Some(floor) = queries::latest_snapshot_floor(&state.db, auth.account_id).await? {
            if since_op_id < floor {
                tracing::info!(
                    snapshot_floor = floor,
                    "ws pull_ops below snapshot floor; sending SnapshotRequired"
                );
                send_msgpack(
                    socket,
                    &ServerFrame::SnapshotRequired { up_to_op_id: floor },
                )
                .await?;
                return Ok(());
            }
        }

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

async fn push_snapshot(
    state: &AppState,
    ws_session: &mut WSSession,
    up_to_op_id: u64,
    blob: EncryptedBlob,
) -> Result<(), SessionError> {
    let span = tracing::info_span!(
        "ws.push_snapshot",
        up_to_op_id = up_to_op_id,
        blob_bytes = blob.ciphertext.len(),
    );
    async {
        let Some(snapshot_lease) = ws_session.snapshot_lease else {
            tracing::warn!("no snapshot lease found");
            return Ok(());
        };
        let result = state
            .snapshot_coordinator_2
            .release(ws_session.auth.account_id, snapshot_lease);
        if let ReleaseResult::Stale = result {
            tracing::warn!("ignoring unsolicited or stale PushSnapshot");
            return Ok(());
        }
        ws_session.snapshot_lease = None;
        // TODO: While this is inserting, an entire other snapshot could feasibly go through..
        let row_id =
            queries::insert_snapshot(&state.db, ws_session.auth.account_id, up_to_op_id, blob)
                .await?;
        tracing::info!(snapshot_row_id = row_id, "ws push_snapshot persisted");
        // Fire-and-forget per spec — no `OpsAck`-style reply. The
        // orchestrator (when wired) tracks completion via the row
        // landing in the snapshots table, not via a wire ack.
        Ok(())
    }
    .instrument(span)
    .await
}

async fn pull_snapshot(
    socket: &mut WebSocket,
    state: &AppState,
    auth: &DeviceAuth,
) -> Result<(), SessionError> {
    let span = tracing::info_span!("ws.pull_snapshot");
    async {
        match queries::latest_snapshot(&state.db, auth.account_id).await? {
            Some(snap) => {
                tracing::info!(up_to_op_id = snap.up_to_op_id, "ws pull_snapshot served");
                send_msgpack(
                    socket,
                    &ServerFrame::Snapshot {
                        up_to_op_id: snap.up_to_op_id,
                        blob: snap.blob,
                    },
                )
                .await
            }
            None => {
                // A well-behaved client only sends `PullSnapshot` after
                // receiving `SnapshotRequired`, which is only emitted
                // when a snapshot exists. If we get here, either the
                // snapshot was deleted out from under us or the client
                // is misbehaving — log and drop the request rather
                // than tearing down the session.
                tracing::warn!("PullSnapshot but no snapshot exists; ignoring");
                Ok(())
            }
        }
    }
    .instrument(span)
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
