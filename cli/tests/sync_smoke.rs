//! End-to-end CLI sync smoke: real airday-server, real Loro, real WS.
//!
//! Bypasses the interactive auth UI by signing up via direct HTTP and
//! materializing the on-disk profile that the CLI would have written.
//! Then drives `Session` directly to verify the sync lifecycle:
//!
//!   open → mutate → flush → re-open → next pull observes nothing new.
//!
//! Confirms ops actually landed on the server by hitting the same
//! sqlite the server uses (via `airday-server`'s public queries
//! module).

use std::sync::OnceLock;
use std::time::Duration;

use airday_cli::config::{DeviceConfig, Profile, Secrets};
use airday_cli::keystore::dek_to_hex;
use airday_cli::sync::Session;
use airday_core::{derive_password_master, random_bytes, Dek, Doc, LIST_CURRENT};
use airday_protocol::{
    DeviceCredential, DeviceRegistration, KdfParams, SignupRequest, SignupResponse,
};
use airday_server::sync::queries;
use airday_server::{router, AppState};
use reqwest::header::CONTENT_TYPE;
use uuid::Uuid;

const MSGPACK: &str = "application/msgpack";

fn weak_params() -> KdfParams {
    KdfParams { m_kib: 8, t: 1, p: 1 }
}

struct TestServer {
    base: String,
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
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self { base, state, handle }
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

async fn signup_via_http(server: &TestServer, dek: &Dek) -> SignupResponse {
    let kdf_params = weak_params();
    let master_salt: [u8; 16] = random_bytes();
    let master =
        derive_password_master(b"correct horse battery staple", &master_salt, kdf_params).unwrap();
    let kek = master.kek().unwrap();
    let auth_secret = master.auth_secret().unwrap();
    let wrapped = kek.wrap(dek).unwrap();
    let req = SignupRequest {
        email: format!("user-{}@example.com", Uuid::now_v7()),
        master_salt: master_salt.to_vec(),
        kdf_params,
        auth_secret: auth_secret.as_bytes().to_vec(),
        wrapped_dek: wrapped.ciphertext,
        wrapped_dek_nonce: wrapped.nonce.to_vec(),
        recovery: None,
        device_name: "smoke-test".into(),
    };
    let bytes = rmp_serde::to_vec_named(&req).unwrap();
    let resp = http()
        .post(format!("{}/api/account/signup", server.base))
        .header(CONTENT_TYPE, MSGPACK)
        .body(bytes)
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success(), "signup failed: {}", resp.status());
    rmp_serde::from_slice(&resp.bytes().await.unwrap()).unwrap()
}

/// Stand up the on-disk profile a real `airday signup` would have
/// written. Constructed directly under `data_dir` so each test owns
/// its profile and parallel runs don't race on `AIRDAY_DATA_DIR`.
fn materialize_profile(
    data_dir: &std::path::Path,
    server_url: &str,
    resp: &SignupResponse,
    dek: &Dek,
    seed_doc: bool,
) -> Profile {
    std::fs::create_dir_all(data_dir).unwrap();
    let profile = Profile { dir: data_dir.to_path_buf() };
    profile
        .write_device(&DeviceConfig {
            account_id: resp.account_id.clone(),
            email: "smoke-test@example.com".into(),
            server_url: server_url.into(),
            device_id: resp.device_id.clone(),
            last_acked_op_id: 0,
            last_sync_at: None,
        })
        .unwrap();
    profile
        .write_secrets(&Secrets {
            device_token: resp.device_token.clone(),
            dek_hex: dek_to_hex(dek),
        })
        .unwrap();
    let doc = if seed_doc { Doc::new().unwrap() } else { Doc::empty() };
    profile.write_doc(&doc).unwrap();
    profile
}

fn reopen_profile(data_dir: &std::path::Path) -> Profile {
    Profile { dir: data_dir.to_path_buf() }
}

#[tokio::test]
async fn session_pushes_and_acks_then_reopen_is_clean() {
    let server = TestServer::start().await;
    let dek = Dek::generate();
    let signup = signup_via_http(&server, &dek).await;

    let tmp = tempfile::tempdir().unwrap();
    let profile = materialize_profile(tmp.path(), &server.base, &signup, &dek, true);

    // First open: connect, handshake, pull (empty). The seed counts
    // as pending so the engine auto-pushes it during open; the
    // user's add_item then ships on flush. Two blobs land server-side.
    let session = Session::open_with_profile(profile, false).await.unwrap();
    assert!(session.is_online(), "expected to connect to local server");
    let item_id = session.doc().add_item(LIST_CURRENT, "hello world").unwrap();
    session.flush().await.unwrap();

    let account_id = Uuid::parse_str(&signup.account_id).unwrap();
    let batch = wait_for_ops(&server, account_id, 2).await;
    assert_eq!(batch.ops.len(), 2, "seed-push + add-item-push");
    let highest_assigned = batch.ops.iter().map(|o| o.id).max().unwrap();

    // Device's frontier should have advanced to the highest assigned id.
    let device_uuid = Uuid::parse_str(&signup.device_id).unwrap();
    let acked = queries::get_last_acked_op_id(&server.state.db, device_uuid)
        .await
        .unwrap();
    assert_eq!(acked, highest_assigned);

    // Re-open. last_acked_op_id is persisted, so the pull is empty,
    // and `pending_export` should be `None`.
    let profile2 = reopen_profile(tmp.path());
    let session2 = Session::open_with_profile(profile2, false).await.unwrap();
    assert!(session2.is_online());
    assert!(session2.doc().get_item(&item_id).is_some(), "item survived round-trip");
    assert!(!session2.doc().has_pending_ops(), "no new local mutations");
    session2.flush().await.unwrap();

    // No new op blobs should have been pushed.
    let after = queries::fetch_ops_batch(&server.state.db, account_id, 0)
        .await
        .unwrap();
    assert_eq!(after.ops.len(), 2, "second flush must not re-push");
}

#[tokio::test]
async fn offline_flag_short_circuits_connect() {
    let tmp = tempfile::tempdir().unwrap();
    let profile = Profile { dir: tmp.path().to_path_buf() };
    let fake_account = Uuid::now_v7().to_string();
    profile
        .write_device(&DeviceConfig {
            account_id: fake_account.clone(),
            email: "offline@example.com".into(),
            server_url: "http://127.0.0.1:1".into(), // guaranteed unreachable
            device_id: Uuid::now_v7().to_string(),
            last_acked_op_id: 0,
            last_sync_at: None,
        })
        .unwrap();
    let dek = Dek::generate();
    profile
        .write_secrets(&Secrets {
            device_token: "deadbeef".repeat(8),
            dek_hex: dek_to_hex(&dek),
        })
        .unwrap();
    profile.write_doc(&Doc::new().unwrap()).unwrap();

    // With --offline the open call is fast — no 2s timeout penalty.
    let started = std::time::Instant::now();
    let session = Session::open_with_profile(profile, true).await.unwrap();
    assert!(started.elapsed() < Duration::from_millis(500));
    assert!(!session.is_online());
    session.flush().await.unwrap();
}

#[tokio::test]
async fn second_device_observes_first_devices_items_via_pull() {
    let server = TestServer::start().await;
    let dek = Dek::generate();
    let signup = signup_via_http(&server, &dek).await;

    // Device A: full profile, seeded doc.
    let tmp_a = tempfile::tempdir().unwrap();
    let profile_a = materialize_profile(tmp_a.path(), &server.base, &signup, &dek, true);

    // Device B: register a second device on the same account, share
    // the DEK (paranthesis: the real device-2 path derives the DEK
    // from password+wrap; here we cheat because we already have it).
    let device_b = register_device_b(&server, &signup.device_token).await;
    let tmp_b = tempfile::tempdir().unwrap();
    let profile_b = Profile { dir: tmp_b.path().to_path_buf() };
    profile_b
        .write_device(&DeviceConfig {
            account_id: signup.account_id.clone(),
            email: "smoke-test@example.com".into(),
            server_url: server.base.clone(),
            device_id: device_b.device_id.clone(),
            last_acked_op_id: 0,
            last_sync_at: None,
        })
        .unwrap();
    profile_b
        .write_secrets(&Secrets {
            device_token: device_b.device_token.clone(),
            dek_hex: dek_to_hex(&dek),
        })
        .unwrap();
    profile_b.write_doc(&Doc::empty()).unwrap();

    // A pushes a new item.
    let session_a = Session::open_with_profile(profile_a, false).await.unwrap();
    let item_id = session_a.doc().add_item(LIST_CURRENT, "from-A").unwrap();
    session_a.flush().await.unwrap();

    // B opens a session — its pull should ingest A's seed + add_item
    // blob and surface the item.
    let session_b = Session::open_with_profile(profile_b, false).await.unwrap();
    assert!(session_b.is_online());
    let view = session_b.doc().get_item(&item_id).unwrap();
    assert_eq!(view.text, "from-A");
    assert_eq!(view.list_id, LIST_CURRENT);
    session_b.flush().await.unwrap();
}

async fn register_device_b(server: &TestServer, owner_token: &str) -> DeviceCredential {
    let bytes = rmp_serde::to_vec_named(&DeviceRegistration {
        name: "device-b".into(),
    })
    .unwrap();
    let resp = http()
        .post(format!("{}/api/devices", server.base))
        .header(CONTENT_TYPE, MSGPACK)
        .bearer_auth(owner_token)
        .body(bytes)
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    rmp_serde::from_slice(&resp.bytes().await.unwrap()).unwrap()
}

async fn wait_for_ops(
    server: &TestServer,
    account_id: Uuid,
    target: usize,
) -> queries::FetchedBatch {
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        let batch = queries::fetch_ops_batch(&server.state.db, account_id, 0)
            .await
            .unwrap();
        if batch.ops.len() >= target {
            return batch;
        }
        if std::time::Instant::now() > deadline {
            panic!(
                "ops never reached target={target} (got {})",
                batch.ops.len()
            );
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}
