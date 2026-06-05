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
use airday_cli::config::{Config, Profile, Secrets};
use airday_cli::keystore::dek_to_hex;
use airday_cli::storage::Account;
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

    let primary_doc_id = Uuid::parse_str(&signup.primary_doc_id).unwrap();
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

/// The CLI is one-shot per command: an offline `add` must be captured
/// into the durable op log, survive a process restart (boot replays it),
/// and ship to the server on the next sync. Exercises the
/// capture → boot-replay → outbox-push path end-to-end.
#[tokio::test]
async fn offline_add_survives_restart_then_syncs() {
    let server = TestServer::start().await;
    let dek = Dek::generate();
    let signup = signup_via_http(&server, &dek, "offline-test").await;

    let tmp = tempfile::tempdir().unwrap();
    let profile = materialize_signup_profile(
        tmp.path(),
        &server.base,
        &signup,
        &dek,
        "offline-test@example.com",
        true,
    )
    .await;

    // Offline add — no connect; the mutation is captured to the op log.
    let session = Session::open_with_profile(profile, false).await.unwrap();
    assert!(!session.is_online());
    let item_id = session.doc().add_item(LIST_MAIN, "offline item").unwrap();
    session.flush().await.unwrap();

    // Restart (still offline): the captured op replays from storage.
    let session2 = Session::open_with_profile(reopen_profile(tmp.path()), false)
        .await
        .unwrap();
    assert!(
        session2.doc().get_item(&item_id).is_some(),
        "offline add survived a restart"
    );
    session2.flush().await.unwrap();

    // Now sync: the outbox op ships to the server.
    let session3 = Session::open_with_profile(reopen_profile(tmp.path()), true)
        .await
        .unwrap();
    assert!(session3.is_online());
    session3.flush().await.unwrap();

    let primary_doc_id = Uuid::parse_str(&signup.primary_doc_id).unwrap();
    let batch = wait_for_ops(&server, primary_doc_id, 1).await;
    assert_eq!(batch.ops.len(), 1, "the offline op reached the server");

    // Reopen once more: clean, nothing re-pushes (op acked + compacted).
    let session4 = Session::open_with_profile(reopen_profile(tmp.path()), true)
        .await
        .unwrap();
    assert!(session4.doc().get_item(&item_id).is_some());
    session4.flush().await.unwrap();
    let after = queries::fetch_ops_batch(&server.state.db, primary_doc_id, 0)
        .await
        .unwrap();
    assert_eq!(after.ops.len(), 1, "no duplicate re-push after ack");
}

/// `last_sync_at` means "last successful *online* sync". It must stay
/// unset across offline flushes (every command flushes, even read-only
/// ones) and land only after a real server exchange. Regression guard
/// for the bug where `flush()` stamped it unconditionally — which made
/// `airday status` report "Last sync: 0s ago" while fully offline.
#[tokio::test]
async fn last_sync_at_set_only_after_online_sync() {
    let server = TestServer::start().await;
    let dek = Dek::generate();
    let signup = signup_via_http(&server, &dek, "lastsync-test").await;

    let tmp = tempfile::tempdir().unwrap();
    let profile = materialize_signup_profile(
        tmp.path(),
        &server.base,
        &signup,
        &dek,
        "lastsync-test@example.com",
        true,
    )
    .await;
    let doc_id = airday_core::DocId(Uuid::parse_str(&signup.primary_doc_id).unwrap());

    // Offline flush, even with a mutation, must not stamp last_sync_at.
    let session = Session::open_with_profile(profile, false).await.unwrap();
    assert!(!session.is_online());
    session.doc().add_item(LIST_MAIN, "offline item").unwrap();
    session.flush().await.unwrap();
    {
        let storage = airday_cli::storage::open_storage(&reopen_profile(tmp.path())).unwrap();
        assert!(
            storage
                .read_sync_cursor(doc_id)
                .unwrap()
                .last_sync_at
                .is_none(),
            "offline flush must not set last_sync_at"
        );
    }

    // A real online sync stamps it.
    let session2 = Session::open_with_profile(reopen_profile(tmp.path()), true)
        .await
        .unwrap();
    assert!(session2.is_online());
    session2.flush().await.unwrap();
    {
        let storage = airday_cli::storage::open_storage(&reopen_profile(tmp.path())).unwrap();
        assert!(
            storage
                .read_sync_cursor(doc_id)
                .unwrap()
                .last_sync_at
                .is_some(),
            "online sync must set last_sync_at"
        );
    }
}

#[tokio::test]
async fn default_open_skips_connect() {
    let tmp = tempfile::tempdir().unwrap();
    let profile = Profile::new(tmp.path().to_path_buf());
    let fake_account = Uuid::now_v7().to_string();
    let fake_doc_uuid = Uuid::now_v7();
    let doc_id = airday_core::DocId(fake_doc_uuid);
    let dek = Dek::generate();
    let storage = airday_cli::storage::open_storage(&profile).unwrap();
    airday_cli::storage::seed_snapshot(&storage, &dek, doc_id, &Doc::new().unwrap()).unwrap();
    storage
        .write_account(&Account {
            account_id: fake_account.clone(),
            email: "offline@example.com".into(),
            device_id: Uuid::now_v7().to_string(),
            primary_doc_id: doc_id,
        })
        .unwrap();
    profile
        .write_config(&Config {
            server_url: "http://127.0.0.1:1".into(), // guaranteed unreachable
        })
        .unwrap();
    profile
        .write_secrets(&Secrets {
            device_token: "deadbeef".repeat(8),
            dek_hex: dek_to_hex(&dek),
        })
        .unwrap();

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
    let primary_doc_uuid = Uuid::parse_str(&signup.primary_doc_id).unwrap();
    let doc_id_b = airday_core::DocId(primary_doc_uuid);
    let storage_b = airday_cli::storage::open_storage(&profile_b).unwrap();
    storage_b
        .write_account(&Account {
            account_id: signup.account_id.clone(),
            email: "smoke-test@example.com".into(),
            device_id: device_b.device_id.clone(),
            primary_doc_id: doc_id_b,
        })
        .unwrap();
    profile_b
        .write_config(&Config {
            server_url: server.base.clone(),
        })
        .unwrap();
    profile_b
        .write_secrets(&Secrets {
            device_token: device_b.device_token.clone(),
            dek_hex: dek_to_hex(&dek),
        })
        .unwrap();
    airday_cli::storage::seed_snapshot(&storage_b, &dek, doc_id_b, &Doc::empty()).unwrap();

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

async fn wait_for_ops(server: &TestServer, doc_id: Uuid, target: usize) -> queries::FetchedBatch {
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
