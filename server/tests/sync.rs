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
use airday_server::auth::{queries as auth_queries, tokens};
use airday_server::sync::queries;
use airday_server::{router, AppState};
use futures_util::{SinkExt, StreamExt};
use http::header::AUTHORIZATION;
use reqwest::header::CONTENT_TYPE;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

const MSGPACK: &str = "application/msgpack";
const TEST_SNAPSHOT_THRESHOLD_OPS: u64 = 10;

fn weak_params() -> KdfParams {
    KdfParams {
        m_kib: 8,
        t: 1,
        p: 1,
    }
}

struct TestServer {
    base: String,
    ws_base: String,
    state: AppState,
    handle: tokio::task::JoinHandle<()>,
}

impl TestServer {
    async fn start() -> Self {
        Self::start_with_snapshot_settings(Duration::from_secs(5 * 60), TEST_SNAPSHOT_THRESHOLD_OPS)
            .await
    }

    async fn start_with_snapshot_timeout(timeout: Duration) -> Self {
        Self::start_with_snapshot_settings(timeout, TEST_SNAPSHOT_THRESHOLD_OPS).await
    }

    async fn start_with_snapshot_settings(timeout: Duration, threshold_ops: u64) -> Self {
        let state = AppState::open_in_memory()
            .await
            .unwrap()
            .with_snapshot_settings(timeout, threshold_ops);
        let app = router(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base = format!("http://{}", addr);
        let ws_base = format!("ws://{}", addr);
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self {
            base,
            ws_base,
            state,
            handle,
        }
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
    device_id: Uuid,
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
        device_id: Uuid::parse_str(&resp.device_id).unwrap(),
        device_token: resp.device_token,
    }
}

async fn signup_account() -> Account {
    signup_account_with_snapshot_timeout(Duration::from_secs(5 * 60)).await
}

async fn signup_account_with_snapshot_timeout(timeout: Duration) -> Account {
    let server = TestServer::start_with_snapshot_timeout(timeout).await;
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

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ack_does_not_move_backwards() {
    let acc = signup_account().await;
    let mut ws = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws).await;

    // Push one op so there's something to ack against.
    send_msgpack(
        &mut ws,
        &ClientFrame::PushOps {
            ops: vec![fake_blob(1)],
        },
    )
    .await;
    let resp: ServerFrame = recv_msgpack(&mut ws).await;
    let id = match resp {
        ServerFrame::OpsAck { assigned_ids } => assigned_ids[0],
        other => panic!("expected OpsAck, got {other:?}"),
    };

    send_msgpack(
        &mut ws,
        &ClientFrame::Ack {
            last_acked_op_id: id,
        },
    )
    .await;
    wait_for_acked(&acc, id).await;
    // Stale ack from a slow client mustn't drag the frontier down.
    send_msgpack(
        &mut ws,
        &ClientFrame::Ack {
            last_acked_op_id: 0,
        },
    )
    .await;
    // Give the server time to *not* apply it.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let stored = queries::get_last_acked_op_id(&acc.server.state.db, acc.device_id)
        .await
        .unwrap();
    assert_eq!(stored, id);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
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
    send_msgpack(&mut ws_a, &ClientFrame::PushOps { ops: blobs.clone() }).await;

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
    let nothing = tokio::time::timeout(std::time::Duration::from_millis(200), ws_a.next()).await;
    assert!(nothing.is_err(), "A unexpectedly received: {nothing:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn subscriber_unregisters_on_disconnect() {
    let acc = signup_account().await;
    let _device_b = register_second_device(&acc, "device-b").await;

    let mut ws_a = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws_a).await;
    wait_for_subscribers(&acc, 1).await;
    drop(ws_a);
    wait_for_subscribers(&acc, 0).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pull_at_or_above_snapshot_floor_streams_ops_normally() {
    // A device whose cursor is already >= the snapshot floor stays
    // on the steady-state op-streaming path — no SnapshotRequired.
    let acc = signup_account().await;
    queries::insert_snapshot(&acc.server.state.db, acc.account_id, 50, fake_blob(0xAA))
        .await
        .unwrap();

    let mut ws = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws).await;

    send_msgpack(&mut ws, &ClientFrame::PullOps { since_op_id: 50 }).await;
    let pulled = expect_complete_batch(&mut ws).await;
    assert!(pulled.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_snapshot_to_unknown_subscriber_reports_undelivered() {
    let acc = signup_account().await;
    let _ws = connect_ws(&acc.server, &acc.device_token).await;
    // No handshake → no subscribe; even with a session, sub_id 9999
    // doesn't exist.
    let delivered = acc
        .server
        .state
        .sync_sessions
        .request_snapshot(acc.account_id, 9999, 7);
    assert!(!delivered);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn snapshot_threshold_targets_highest_acked_connected_device() {
    let acc = signup_account().await;
    let device_b = register_second_device(&acc, "device-b").await;

    let mut ws_a = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws_a).await;
    let mut ws_b = connect_ws(&acc.server, &device_b.device_token).await;
    handshake(&mut ws_b).await;
    wait_for_subscribers(&acc, 2).await;

    send_msgpack(
        &mut ws_b,
        &ClientFrame::PushOps {
            ops: vec![fake_blob(0xB1)],
        },
    )
    .await;
    let b_first_id = recv_ops_ack(&mut ws_b).await[0];
    send_msgpack(
        &mut ws_b,
        &ClientFrame::Ack {
            last_acked_op_id: b_first_id,
        },
    )
    .await;
    wait_for_acked_token(&acc.server.state, &device_b.device_token, b_first_id).await;

    let big_push: Vec<EncryptedBlob> = (0..=TEST_SNAPSHOT_THRESHOLD_OPS)
        .map(|i| fake_blob((i % 251) as u8))
        .collect();
    send_msgpack(&mut ws_a, &ClientFrame::PushOps { ops: big_push }).await;
    assert_eq!(
        recv_ops_ack(&mut ws_a).await.len() as u64,
        TEST_SNAPSHOT_THRESHOLD_OPS + 1
    );
    wait_for_snapshot_assignee(
        &acc.server.state,
        acc.account_id,
        device_b.device_id,
        acc.device_id,
        b_first_id,
    )
    .await;

    let nothing = tokio::time::timeout(Duration::from_millis(200), ws_a.next()).await;
    assert!(nothing.is_err(), "A unexpectedly received: {nothing:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn snapshot_request_starts_when_ack_makes_existing_connection_eligible() {
    let acc = signup_account().await;
    let mut ws_a = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws_a).await;
    wait_for_subscribers(&acc, 1).await;

    // Cross the threshold while no connected device is yet eligible
    // to produce a snapshot: A has not acked any op beyond floor=0.
    let big_push: Vec<EncryptedBlob> = (0..=TEST_SNAPSHOT_THRESHOLD_OPS)
        .map(|i| fake_blob((i % 251) as u8))
        .collect();
    send_msgpack(&mut ws_a, &ClientFrame::PushOps { ops: big_push }).await;
    let assigned_ids = recv_ops_ack(&mut ws_a).await;
    let highest = *assigned_ids.last().unwrap();

    let nothing = tokio::time::timeout(Duration::from_millis(200), ws_a.next()).await;
    assert!(
        nothing.is_err(),
        "snapshot should not start before any device has acked progress"
    );

    send_msgpack(
        &mut ws_a,
        &ClientFrame::Ack {
            last_acked_op_id: highest,
        },
    )
    .await;
    wait_for_acked(&acc, highest).await;
    wait_for_snapshot_assignee(
        &acc.server.state,
        acc.account_id,
        acc.device_id,
        Uuid::nil(),
        highest,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn snapshot_request_retries_when_assigned_device_disconnects() {
    let acc = signup_account().await;
    let device_b = register_second_device(&acc, "device-b").await;

    let mut ws_a = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws_a).await;
    let mut ws_b = connect_ws(&acc.server, &device_b.device_token).await;
    handshake(&mut ws_b).await;
    wait_for_subscribers(&acc, 2).await;

    send_msgpack(
        &mut ws_a,
        &ClientFrame::PushOps {
            ops: vec![fake_blob(0xA1)],
        },
    )
    .await;
    let a_first_id = recv_ops_ack(&mut ws_a).await[0];
    send_msgpack(
        &mut ws_a,
        &ClientFrame::Ack {
            last_acked_op_id: a_first_id,
        },
    )
    .await;
    wait_for_acked(&acc, a_first_id).await;

    send_msgpack(
        &mut ws_b,
        &ClientFrame::PushOps {
            ops: vec![fake_blob(0xB2)],
        },
    )
    .await;
    let b_first_id = recv_ops_ack(&mut ws_b).await[0];
    send_msgpack(
        &mut ws_b,
        &ClientFrame::Ack {
            last_acked_op_id: b_first_id,
        },
    )
    .await;
    wait_for_acked_token(&acc.server.state, &device_b.device_token, b_first_id).await;

    let big_push: Vec<EncryptedBlob> = (0..=TEST_SNAPSHOT_THRESHOLD_OPS)
        .map(|i| fake_blob((i % 251) as u8))
        .collect();
    send_msgpack(&mut ws_a, &ClientFrame::PushOps { ops: big_push }).await;
    assert_eq!(
        recv_ops_ack(&mut ws_a).await.len() as u64,
        TEST_SNAPSHOT_THRESHOLD_OPS + 1
    );
    wait_for_snapshot_assignee(
        &acc.server.state,
        acc.account_id,
        device_b.device_id,
        acc.device_id,
        b_first_id,
    )
    .await;

    drop(ws_b);
    wait_for_subscribers(&acc, 1).await;

    wait_for_snapshot_assignee(
        &acc.server.state,
        acc.account_id,
        acc.device_id,
        device_b.device_id,
        a_first_id,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn snapshot_request_retries_after_timeout() {
    let acc = signup_account_with_snapshot_timeout(Duration::from_millis(50)).await;
    let device_b = register_second_device(&acc, "device-b").await;

    let mut ws_a = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws_a).await;
    let mut ws_b = connect_ws(&acc.server, &device_b.device_token).await;
    handshake(&mut ws_b).await;
    wait_for_subscribers(&acc, 2).await;

    send_msgpack(
        &mut ws_a,
        &ClientFrame::PushOps {
            ops: vec![fake_blob(0xA2)],
        },
    )
    .await;
    let a_first_id = recv_ops_ack(&mut ws_a).await[0];
    send_msgpack(
        &mut ws_a,
        &ClientFrame::Ack {
            last_acked_op_id: a_first_id,
        },
    )
    .await;
    wait_for_acked(&acc, a_first_id).await;

    send_msgpack(
        &mut ws_b,
        &ClientFrame::PushOps {
            ops: vec![fake_blob(0xB3)],
        },
    )
    .await;
    let b_first_id = recv_ops_ack(&mut ws_b).await[0];
    send_msgpack(
        &mut ws_b,
        &ClientFrame::Ack {
            last_acked_op_id: b_first_id,
        },
    )
    .await;
    wait_for_acked_token(&acc.server.state, &device_b.device_token, b_first_id).await;

    let big_push: Vec<EncryptedBlob> = (0..=TEST_SNAPSHOT_THRESHOLD_OPS)
        .map(|i| fake_blob((i % 251) as u8))
        .collect();
    send_msgpack(&mut ws_a, &ClientFrame::PushOps { ops: big_push }).await;
    assert_eq!(
        recv_ops_ack(&mut ws_a).await.len() as u64,
        TEST_SNAPSHOT_THRESHOLD_OPS + 1
    );
    wait_for_snapshot_assignee(
        &acc.server.state,
        acc.account_id,
        device_b.device_id,
        acc.device_id,
        b_first_id,
    )
    .await;
    wait_for_snapshot_assignee(
        &acc.server.state,
        acc.account_id,
        acc.device_id,
        device_b.device_id,
        a_first_id,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stale_snapshot_from_timed_out_assignee_is_ignored() {
    let acc = signup_account_with_snapshot_timeout(Duration::from_millis(100)).await;
    let device_b = register_second_device(&acc, "device-b").await;

    let mut ws_a = connect_ws(&acc.server, &acc.device_token).await;
    handshake(&mut ws_a).await;
    let mut ws_b = connect_ws(&acc.server, &device_b.device_token).await;
    handshake(&mut ws_b).await;
    wait_for_subscribers(&acc, 2).await;

    send_msgpack(
        &mut ws_a,
        &ClientFrame::PushOps {
            ops: vec![fake_blob(0xC1)],
        },
    )
    .await;
    let a_first_id = recv_ops_ack(&mut ws_a).await[0];
    send_msgpack(
        &mut ws_a,
        &ClientFrame::Ack {
            last_acked_op_id: a_first_id,
        },
    )
    .await;
    wait_for_acked(&acc, a_first_id).await;

    send_msgpack(
        &mut ws_b,
        &ClientFrame::PushOps {
            ops: vec![fake_blob(0xC2)],
        },
    )
    .await;
    let b_first_id = recv_ops_ack(&mut ws_b).await[0];
    send_msgpack(
        &mut ws_b,
        &ClientFrame::Ack {
            last_acked_op_id: b_first_id,
        },
    )
    .await;
    wait_for_acked_token(&acc.server.state, &device_b.device_token, b_first_id).await;

    let big_push: Vec<EncryptedBlob> = (0..=TEST_SNAPSHOT_THRESHOLD_OPS)
        .map(|i| fake_blob((i % 251) as u8))
        .collect();
    send_msgpack(&mut ws_a, &ClientFrame::PushOps { ops: big_push }).await;
    let assigned_ids = recv_ops_ack(&mut ws_a).await;
    let latest_id = *assigned_ids.last().unwrap();

    wait_for_snapshot_assignee(
        &acc.server.state,
        acc.account_id,
        acc.device_id,
        device_b.device_id,
        latest_id,
    )
    .await;

    send_msgpack(
        &mut ws_b,
        &ClientFrame::PushSnapshot {
            up_to_op_id: latest_id,
            blob: fake_blob(0xEE),
        },
    )
    .await;
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert!(
        queries::latest_snapshot(&acc.server.state.db, acc.account_id)
            .await
            .unwrap()
            .is_none(),
        "timed-out assignee must not persist a stale snapshot"
    );

    let accepted = fake_blob(0xEF);
    send_msgpack(
        &mut ws_a,
        &ClientFrame::PushSnapshot {
            up_to_op_id: latest_id,
            blob: accepted.clone(),
        },
    )
    .await;
    let snap = wait_for_snapshot(&acc, latest_id).await;
    assert_eq!(snap.blob, accepted);
}

async fn wait_for_snapshot(acc: &Account, up_to: u64) -> queries::LatestSnapshot {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        if let Some(snap) = queries::latest_snapshot(&acc.server.state.db, acc.account_id)
            .await
            .unwrap()
        {
            if snap.up_to_op_id == up_to {
                return snap;
            }
        }
        if std::time::Instant::now() > deadline {
            panic!("snapshot up_to={up_to} never landed");
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
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

async fn recv_ops_ack(ws: &mut WsStream) -> Vec<u64> {
    loop {
        match recv_msgpack::<ServerFrame>(ws).await {
            ServerFrame::OpsAck { assigned_ids } => return assigned_ids,
            ServerFrame::OpsBroadcast { .. } => continue,
            other => panic!("expected OpsAck, got {other:?}"),
        }
    }
}

async fn wait_for_snapshot_assignee(
    state: &AppState,
    account_id: Uuid,
    expected_device_id: Uuid,
    rejected_device_id: Uuid,
    up_to_op_id: u64,
) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        let expected_allowed = state.snapshot_coordinator.permits_snapshot(
            account_id,
            expected_device_id,
            up_to_op_id,
        );
        let rejected_allowed = rejected_device_id != Uuid::nil()
            && state.snapshot_coordinator.permits_snapshot(
                account_id,
                rejected_device_id,
                up_to_op_id,
            );
        if expected_allowed && !rejected_allowed {
            return;
        }
        if std::time::Instant::now() > deadline {
            panic!(
                "snapshot assignee did not switch to {expected_device_id} (expected_allowed={expected_allowed}, rejected_allowed={rejected_allowed})"
            );
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

/// Poll until the hub holds at least `target` subscribers for the
/// account. Subscription happens just after the handshake, so this
/// closes the small window between the client seeing `HelloAck` and
/// the server registering the subscriber.
async fn wait_for_subscribers(acc: &Account, target: usize) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        let count = acc
            .server
            .state
            .sync_sessions
            .subscriber_count(acc.account_id);
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

async fn wait_for_acked_token(state: &AppState, device_token: &str, target: u64) -> u64 {
    let raw = tokens::decode_token(device_token).unwrap();
    let hash = tokens::sha256(&raw).to_vec();
    let lookup = auth_queries::find_device_by_token_hash(&state.db, hash)
        .await
        .unwrap()
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        let stored = queries::get_last_acked_op_id(&state.db, lookup.device_id)
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
