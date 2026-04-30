//! End-to-end WS sync: real server, real sqlite, real msgpack frames.
//!
//! Op blobs in these tests are random bytes — the server treats them
//! as opaque, so we don't need the real DEK. Signup still needs valid
//! crypto material because the auth route checks shape; we use the
//! weak Argon2 params from the auth tests so the suite stays fast.

use airday_core::{derive_password_master, random_bytes, Dek};
use airday_protocol::{
    ClientFrame, DeviceCredential, DeviceRegistration, EncryptedBlob, Hello, HelloAck,
    HelloRejected, KdfParams, ServerFrame, SignupRequest, SignupResponse, StoredOp,
    PROTOCOL_VERSION,
};
use airday_server::sync::queries;
use airday_server::{router, AppState};
use futures_util::{SinkExt, StreamExt};
use http::header::AUTHORIZATION;
use reqwest::header::CONTENT_TYPE;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::sync::OnceLock;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

const MSGPACK: &str = "application/msgpack";

fn weak_params() -> KdfParams {
    KdfParams { m_kib: 8, t: 1, p: 1 }
}

struct TestServer {
    base: String,
    ws_base: String,
    state: AppState,
    handle: tokio::task::JoinHandle<()>,
}

impl TestServer {
    async fn start() -> Self {
        let state = AppState::open_in_memory().await.unwrap();
        let app = router(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base = format!("http://{}", addr);
        let ws_base = format!("ws://{}", addr);
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self { base, ws_base, state, handle }
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

fn http() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(reqwest::Client::new)
}

async fn post_msgpack<Req, Resp>(url: &str, body: &Req) -> Resp
where
    Req: Serialize,
    Resp: DeserializeOwned,
{
    post_msgpack_authed(url, body, None).await
}

async fn post_msgpack_authed<Req, Resp>(url: &str, body: &Req, token: Option<&str>) -> Resp
where
    Req: Serialize,
    Resp: DeserializeOwned,
{
    let bytes = rmp_serde::to_vec_named(body).unwrap();
    let mut req = http().post(url).header(CONTENT_TYPE, MSGPACK).body(bytes);
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await.unwrap();
    assert!(
        resp.status().is_success(),
        "expected 2xx, got {}: {}",
        resp.status(),
        resp.text().await.unwrap_or_default()
    );
    let bytes = resp.bytes().await.unwrap();
    rmp_serde::from_slice(&bytes).unwrap()
}

struct Account {
    server: TestServer,
    device_token: String,
    device_id: Uuid,
    account_id: Uuid,
}

struct ExtraDevice {
    device_token: String,
}

async fn register_second_device(acc: &Account, name: &str) -> ExtraDevice {
    let resp: DeviceCredential = post_msgpack_authed(
        &format!("{}/api/devices", acc.server.base),
        &DeviceRegistration { name: name.into() },
        Some(&acc.device_token),
    )
    .await;
    ExtraDevice {
        device_token: resp.device_token,
    }
}

async fn signup_account() -> Account {
    let server = TestServer::start().await;
    let email = format!("user-{}@example.com", Uuid::now_v7());
    let kdf_params = weak_params();
    let master_salt: [u8; 16] = random_bytes();
    let master =
        derive_password_master(b"correct horse battery staple", &master_salt, kdf_params).unwrap();
    let kek = master.kek().unwrap();
    let auth_secret = master.auth_secret().unwrap();
    let dek = Dek::generate();
    let wrapped = kek.wrap(&dek).unwrap();

    let resp: SignupResponse = post_msgpack(
        &format!("{}/api/account/signup", server.base),
        &SignupRequest {
            email,
            master_salt: master_salt.to_vec(),
            kdf_params,
            auth_secret: auth_secret.as_bytes().to_vec(),
            wrapped_dek: wrapped.ciphertext,
            wrapped_dek_nonce: wrapped.nonce.to_vec(),
            recovery: None,
            device_name: "sync-test".into(),
        },
    )
    .await;
    Account {
        device_id: Uuid::parse_str(&resp.device_id).unwrap(),
        account_id: Uuid::parse_str(&resp.account_id).unwrap(),
        device_token: resp.device_token,
        server,
    }
}

type WsStream = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

async fn connect_ws(server: &TestServer, token: &str) -> WsStream {
    let url = format!("{}/api/sync", server.ws_base);
    let mut req = url.into_client_request().unwrap();
    req.headers_mut()
        .insert(AUTHORIZATION, format!("Bearer {token}").parse().unwrap());
    let (ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
    ws
}

async fn send_msgpack<T: Serialize>(ws: &mut WsStream, value: &T) {
    let bytes = rmp_serde::to_vec_named(value).unwrap();
    ws.send(Message::Binary(bytes)).await.unwrap();
}

async fn recv_msgpack<T: DeserializeOwned>(ws: &mut WsStream) -> T {
    loop {
        let msg = ws.next().await.expect("stream closed").unwrap();
        match msg {
            Message::Binary(bytes) => return rmp_serde::from_slice(&bytes).unwrap(),
            Message::Ping(_) | Message::Pong(_) => continue,
            other => panic!("unexpected ws message: {:?}", other),
        }
    }
}

async fn handshake(ws: &mut WsStream) -> HelloAck {
    send_msgpack(
        ws,
        &Hello {
            client: "airday-cli-test".into(),
            client_version: env!("CARGO_PKG_VERSION").into(),
            supported_protocol_versions: vec![PROTOCOL_VERSION],
        },
    )
    .await;
    recv_msgpack(ws).await
}

fn fake_blob(seed: u8) -> EncryptedBlob {
    EncryptedBlob {
        nonce: vec![seed; 24],
        ciphertext: vec![seed; 64],
    }
}

#[tokio::test]
async fn handshake_then_push_pull_ack_round_trips() {
    let acc = signup_account().await;
    let mut ws = connect_ws(&acc.server, &acc.device_token).await;

    let ack = handshake(&mut ws).await;
    assert_eq!(ack.protocol_version, PROTOCOL_VERSION);

    // Push three ops.
    let blobs = vec![fake_blob(1), fake_blob(2), fake_blob(3)];
    send_msgpack(
        &mut ws,
        &ClientFrame::PushOps { ops: blobs.clone() },
    )
    .await;
    let resp: ServerFrame = recv_msgpack(&mut ws).await;
    let assigned_ids = match resp {
        ServerFrame::OpsAck { assigned_ids } => assigned_ids,
        other => panic!("expected OpsAck, got {other:?}"),
    };
    assert_eq!(assigned_ids.len(), 3);
    // Strictly monotonic across the push.
    assert!(assigned_ids.windows(2).all(|w| w[0] < w[1]));

    // Pull from 0 — single batch with complete=true.
    send_msgpack(&mut ws, &ClientFrame::PullOps { since_op_id: 0 }).await;
    let pulled = expect_complete_batch(&mut ws).await;
    let want: Vec<StoredOp> = assigned_ids
        .iter()
        .copied()
        .zip(blobs.iter().cloned())
        .map(|(id, blob)| StoredOp { id, blob })
        .collect();
    assert_eq!(pulled, want);

    // Ack the last id and verify it persisted.
    let last = *assigned_ids.last().unwrap();
    send_msgpack(&mut ws, &ClientFrame::Ack { last_acked_op_id: last }).await;
    // Ack is fire-and-forget — give the server a tick to commit, then
    // read the row directly.
    let stored = wait_for_acked(&acc, last).await;
    assert_eq!(stored, last);
}

#[tokio::test]
async fn pull_with_no_ops_returns_empty_complete_batch() {
    let acc = signup_account().await;
    let mut ws = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws).await;

    send_msgpack(&mut ws, &ClientFrame::PullOps { since_op_id: 0 }).await;
    let pulled = expect_complete_batch(&mut ws).await;
    assert!(pulled.is_empty());
}

#[tokio::test]
async fn ack_does_not_move_backwards() {
    let acc = signup_account().await;
    let mut ws = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws).await;

    // Push one op so there's something to ack against.
    send_msgpack(
        &mut ws,
        &ClientFrame::PushOps { ops: vec![fake_blob(1)] },
    )
    .await;
    let resp: ServerFrame = recv_msgpack(&mut ws).await;
    let id = match resp {
        ServerFrame::OpsAck { assigned_ids } => assigned_ids[0],
        other => panic!("expected OpsAck, got {other:?}"),
    };

    send_msgpack(&mut ws, &ClientFrame::Ack { last_acked_op_id: id }).await;
    wait_for_acked(&acc, id).await;
    // Stale ack from a slow client mustn't drag the frontier down.
    send_msgpack(&mut ws, &ClientFrame::Ack { last_acked_op_id: 0 }).await;
    // Give the server time to *not* apply it.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let stored = queries::get_last_acked_op_id(&acc.server.state.db, acc.device_id)
        .await
        .unwrap();
    assert_eq!(stored, id);
}

#[tokio::test]
async fn handshake_rejected_when_no_shared_protocol_version() {
    let acc = signup_account().await;
    let mut ws = connect_ws(&acc.server, &acc.device_token).await;

    send_msgpack(
        &mut ws,
        &Hello {
            client: "airday-cli-test".into(),
            client_version: "0.0.0".into(),
            supported_protocol_versions: vec![999],
        },
    )
    .await;
    let rejected: HelloRejected = recv_msgpack(&mut ws).await;
    assert!(rejected.reason.contains("no shared protocol version"));
}

#[tokio::test]
async fn ws_upgrade_without_token_is_rejected() {
    let server = TestServer::start().await;
    let url = format!("{}/api/sync", server.ws_base);
    let req = url.into_client_request().unwrap();
    let err = tokio_tungstenite::connect_async(req).await.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("401") || msg.contains("Unauthorized"),
        "expected 401 in error, got: {msg}"
    );
}

#[tokio::test]
async fn push_on_a_broadcasts_to_b_not_a() {
    let acc = signup_account().await;
    let device_b = register_second_device(&acc, "device-b").await;

    let mut ws_a = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws_a).await;
    let mut ws_b = connect_ws(&acc.server, &device_b.device_token).await;
    handshake(&mut ws_b).await;

    // Both sessions subscribe immediately after handshake; wait for
    // the registry to reflect that before pushing into broadcast.
    wait_for_subscribers(&acc, 2).await;

    let blobs = vec![fake_blob(7), fake_blob(8)];
    send_msgpack(
        &mut ws_a,
        &ClientFrame::PushOps { ops: blobs.clone() },
    )
    .await;

    // A receives its own OpsAck; A must NOT receive a broadcast for
    // its own push. Asserting absence requires a small wait —
    // anything pending arrives well within 200ms on localhost.
    let assigned_ids = match recv_msgpack::<ServerFrame>(&mut ws_a).await {
        ServerFrame::OpsAck { assigned_ids } => assigned_ids,
        other => panic!("expected OpsAck on A, got {other:?}"),
    };
    assert_eq!(assigned_ids.len(), 2);

    // B receives the broadcast with the same ids/blobs.
    let broadcast = match recv_msgpack::<ServerFrame>(&mut ws_b).await {
        ServerFrame::OpsBroadcast { ops } => ops,
        other => panic!("expected OpsBroadcast on B, got {other:?}"),
    };
    let want: Vec<StoredOp> = assigned_ids
        .iter()
        .copied()
        .zip(blobs)
        .map(|(id, blob)| StoredOp { id, blob })
        .collect();
    assert_eq!(broadcast, want);

    // A's stream should have nothing pending.
    let nothing = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        ws_a.next(),
    )
    .await;
    assert!(nothing.is_err(), "A unexpectedly received: {nothing:?}");
}

#[tokio::test]
async fn push_on_one_tab_broadcasts_to_other_tab_same_device() {
    // Multi-tab on the same device: two WS connections share the
    // device cookie. Broadcast must exclude only the originating
    // *connection*, not every connection sharing the device id —
    // otherwise tab→tab updates silently drop.
    let acc = signup_account().await;

    let mut tab_a = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut tab_a).await;
    let mut tab_b = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut tab_b).await;
    wait_for_subscribers(&acc, 2).await;

    let blobs = vec![fake_blob(11)];
    send_msgpack(&mut tab_a, &ClientFrame::PushOps { ops: blobs.clone() }).await;

    // Tab A — its own ack, no broadcast echo.
    let assigned_ids = match recv_msgpack::<ServerFrame>(&mut tab_a).await {
        ServerFrame::OpsAck { assigned_ids } => assigned_ids,
        other => panic!("expected OpsAck on A, got {other:?}"),
    };
    assert_eq!(assigned_ids.len(), 1);

    // Tab B — receives the broadcast even though it shares device_id.
    let broadcast = match recv_msgpack::<ServerFrame>(&mut tab_b).await {
        ServerFrame::OpsBroadcast { ops } => ops,
        other => panic!("expected OpsBroadcast on B, got {other:?}"),
    };
    let want: Vec<StoredOp> = assigned_ids
        .into_iter()
        .zip(blobs)
        .map(|(id, blob)| StoredOp { id, blob })
        .collect();
    assert_eq!(broadcast, want);
}

#[tokio::test]
async fn subscriber_unregisters_on_disconnect() {
    let acc = signup_account().await;
    let _device_b = register_second_device(&acc, "device-b").await;

    let mut ws_a = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws_a).await;
    wait_for_subscribers(&acc, 1).await;
    drop(ws_a);
    wait_for_subscribers(&acc, 0).await;
}

async fn expect_complete_batch(ws: &mut WsStream) -> Vec<StoredOp> {
    match recv_msgpack(ws).await {
        ServerFrame::OpsBatch { ops, complete } => {
            assert!(complete, "expected single complete batch");
            ops
        }
        other => panic!("expected OpsBatch, got {other:?}"),
    }
}

/// Poll until the hub holds at least `target` subscribers for the
/// account. Subscription happens just after the handshake, so this
/// closes the small window between the client seeing `HelloAck` and
/// the server registering the subscriber.
async fn wait_for_subscribers(acc: &Account, target: usize) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        let count = acc.server.state.sync_sessions.subscriber_count(acc.account_id);
        if (target == 0 && count == 0) || (target > 0 && count >= target) {
            return;
        }
        if std::time::Instant::now() > deadline {
            panic!("subscriber count never reached {target} (stuck at {count})");
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

/// Poll until the device row's `last_acked_op_id` reaches the target,
/// then return whatever the row holds. Avoids racing the WS task's
/// commit point.
async fn wait_for_acked(acc: &Account, target: u64) -> u64 {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        let stored = queries::get_last_acked_op_id(&acc.server.state.db, acc.device_id)
            .await
            .unwrap();
        if stored >= target {
            return stored;
        }
        if std::time::Instant::now() > deadline {
            panic!("ack never reached {target} (stuck at {stored})");
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}
