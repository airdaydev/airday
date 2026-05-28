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

use std::time::Duration;

use airday_cli::commands::export::write_export;
use airday_cli::config::{DeviceConfig, Profile, Secrets};
use airday_cli::keystore::dek_to_hex;
use airday_cli::sync::Session;
use airday_core::{Dek, Doc, LIST_MAIN};
use airday_server::sync::queries;
use uuid::Uuid;

mod support;

use support::{
    materialize_signup_profile, register_device, reopen_profile, signup_via_http, TestServer,
};

#[tokio::test]
async fn session_pushes_and_acks_then_reopen_is_clean() {
    let server = TestServer::start().await;
    let dek = Dek::generate();
    let signup = signup_via_http(&server, &dek, "smoke-test").await;

    let tmp = tempfile::tempdir().unwrap();
    let profile = materialize_signup_profile(
        tmp.path(),
        &server.base,
        &signup,
        &dek,
        "smoke-test@example.com",
        true,
    )
    .await;

    // First open: connect, handshake, pull (empty). The seeded doc is
    // already persisted locally; only the user's new mutation should
    // ship on flush.
    let session = Session::open_with_profile(profile, true).await.unwrap();
    assert!(session.is_online(), "expected to connect to local server");
    let item_id = session.doc().add_item(LIST_MAIN, "hello world").unwrap();
    session.flush().await.unwrap();

    let account_id = Uuid::parse_str(&signup.account_id).unwrap();
    let primary_doc_id = airday_server::auth::queries::find_account_by_id(&server.state.db, account_id)
        .await
        .unwrap()
        .expect("account just created should be findable")
        .primary_doc_id;
    let batch = wait_for_ops(&server, primary_doc_id, 1).await;
    assert_eq!(batch.ops.len(), 1, "only the add-item mutation should push");
    let highest_assigned = batch.ops.iter().map(|o| o.seq).max().unwrap();

    // Device's frontier should have advanced to the highest assigned id.
    let device_uuid = Uuid::parse_str(&signup.device_id).unwrap();
    let acked = queries::get_last_acked_seq(&server.state.db, device_uuid)
        .await
        .unwrap();
    assert_eq!(acked, highest_assigned);

    // Re-open. last_acked_seq is persisted, so the pull is empty,
    // and `pending_export` should be `None`.
    let profile2 = reopen_profile(tmp.path());
    let session2 = Session::open_with_profile(profile2, true).await.unwrap();
    assert!(session2.is_online());
    assert!(
        session2.doc().get_item(&item_id).is_some(),
        "item survived round-trip"
    );
    assert!(!session2.doc().has_pending_ops(), "no new local mutations");
    session2.flush().await.unwrap();

    // No new op blobs should have been pushed.
    let after = queries::fetch_ops_batch(&server.state.db, primary_doc_id, 0)
        .await
        .unwrap();
    assert_eq!(after.ops.len(), 1, "second flush must not re-push");
}

#[tokio::test]
async fn default_open_skips_connect() {
    let tmp = tempfile::tempdir().unwrap();
    let profile = Profile::new(tmp.path().to_path_buf());
    let fake_account = Uuid::now_v7().to_string();
    profile
        .write_device(&DeviceConfig {
            account_id: fake_account.clone(),
            email: "offline@example.com".into(),
            server_url: "http://127.0.0.1:1".into(), // guaranteed unreachable
            device_id: Uuid::now_v7().to_string(),
            last_acked_seq: 0,
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
    profile.write_doc(&Doc::new().unwrap()).await.unwrap();

    // Without --sync the open call is fast — no 2s timeout penalty.
    let started = std::time::Instant::now();
    let session = Session::open_with_profile(profile, false).await.unwrap();
    assert!(started.elapsed() < Duration::from_millis(500));
    assert!(!session.is_online());
    session.flush().await.unwrap();
}

#[tokio::test]
async fn export_json_writes_semantic_account_dump() {
    let tmp = tempfile::tempdir().unwrap();
    let doc = Doc::new().unwrap();
    let errands = doc.add_list("Errands").unwrap();
    let item_id = doc.add_item(&errands, "buy milk").unwrap();
    doc.edit_item_notes(&item_id, "whole milk").unwrap();

    let out = tmp.path().join("export.json");
    write_export(&doc.export_json(), Some(&out)).unwrap();

    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(out).unwrap()).unwrap();
    assert_eq!(value["version"], 1);
    assert_eq!(value["lists"][0]["id"], LIST_MAIN);
    assert_eq!(value["lists"][0]["name"], "Queue");
    assert_eq!(value["items"][0]["id"], item_id);
    assert_eq!(value["items"][0]["notes"], "whole milk");
}

#[tokio::test]
async fn second_device_observes_first_devices_items_via_pull() {
    let server = TestServer::start().await;
    let dek = Dek::generate();
    let signup = signup_via_http(&server, &dek, "smoke-test").await;

    // Device A: full profile, fresh doc.
    let tmp_a = tempfile::tempdir().unwrap();
    let profile_a = materialize_signup_profile(
        tmp_a.path(),
        &server.base,
        &signup,
        &dek,
        "smoke-test@example.com",
        true,
    )
    .await;

    // Device B: register a second device on the same account, share
    // the DEK (paranthesis: the real device-2 path derives the DEK
    // from password+wrap; here we cheat because we already have it).
    let device_b = register_device(&server, &signup.device_token, "device-b").await;
    let tmp_b = tempfile::tempdir().unwrap();
    let profile_b = Profile::new(tmp_b.path().to_path_buf());
    profile_b
        .write_device(&DeviceConfig {
            account_id: signup.account_id.clone(),
            email: "smoke-test@example.com".into(),
            server_url: server.base.clone(),
            device_id: device_b.device_id.clone(),
            last_acked_seq: 0,
            last_sync_at: None,
        })
        .unwrap();
    profile_b
        .write_secrets(&Secrets {
            device_token: device_b.device_token.clone(),
            dek_hex: dek_to_hex(&dek),
        })
        .unwrap();
    profile_b.write_doc(&Doc::empty()).await.unwrap();

    // A pushes a new item.
    let session_a = Session::open_with_profile(profile_a, true).await.unwrap();
    let item_id = session_a.doc().add_item(LIST_MAIN, "from-A").unwrap();
    session_a.flush().await.unwrap();

    // B opens a session — its pull should ingest A's seed + add_item
    // blob and surface the item.
    let session_b = Session::open_with_profile(profile_b, true).await.unwrap();
    assert!(session_b.is_online());
    let view = session_b.doc().get_item(&item_id).unwrap();
    assert_eq!(view.text, "from-A");
    assert_eq!(view.list_id, LIST_MAIN);
    session_b.flush().await.unwrap();
}

async fn wait_for_ops(
    server: &TestServer,
    doc_id: Uuid,
    target: usize,
) -> queries::FetchedBatch {
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        let batch = queries::fetch_ops_batch(&server.state.db, doc_id, 0)
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
