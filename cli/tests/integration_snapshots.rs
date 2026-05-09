//! CLI-facing snapshot integration: real airday-server, real
//! `Session`, real encrypted ops, real snapshot upload.
//!
//! The long-lived client here is `airday_cli::sync::Session`. We keep
//! device A connected while device B reconnects repeatedly to push
//! enough ops to cross the server's snapshot threshold. Device A must
//! keep draining inbound frames so the server can assign it
//! `SnapshotRequest` and receive the matching `PushSnapshot`.

use std::time::Duration;

use airday_cli::sync::Session;
use airday_core::{Dek, LIST_MAIN};
use airday_server::sync::queries;
use airday_server::AppState;
use uuid::Uuid;

mod support;

use support::{materialize_profile, register_device, reopen_profile, signup_via_http, TestServer};

const TEST_SNAPSHOT_THRESHOLD_OPS: u64 = 10;

#[tokio::test]
async fn long_lived_session_services_server_snapshot_request() {
    let state = AppState::open_in_memory()
        .await
        .unwrap()
        .with_snapshot_threshold(TEST_SNAPSHOT_THRESHOLD_OPS);
    let server = TestServer::start_with_state(state).await;
    let dek = Dek::generate();
    let signup = signup_via_http(&server, &dek, "snapshot-test-a").await;
    let device_b = register_device(&server, &signup.device_token, "snapshot-test-b").await;

    let tmp_a = tempfile::tempdir().unwrap();
    let tmp_b = tempfile::tempdir().unwrap();
    let profile_a = materialize_profile(
        tmp_a.path(),
        &server.base,
        &signup.account_id,
        &signup.device_id,
        &signup.device_token,
        &dek,
        "snapshot-test@example.com",
        true,
    );
    materialize_profile(
        tmp_b.path(),
        &server.base,
        &signup.account_id,
        &device_b.device_id,
        &device_b.device_token,
        &dek,
        "snapshot-test@example.com",
        false,
    );

    let mut session_a = Session::open_with_profile(profile_a, true).await.unwrap();
    assert!(session_a.is_online(), "device A should stay connected");
    session_a
        .pump_until_quiet(Duration::from_millis(50))
        .await
        .unwrap();

    for i in 0..=TEST_SNAPSHOT_THRESHOLD_OPS {
        let profile_b = reopen_profile(tmp_b.path());
        let session_b = Session::open_with_profile(profile_b, true).await.unwrap();
        let item_id = session_b
            .doc()
            .add_item(LIST_MAIN, &format!("from-b-{i}"))
            .unwrap();
        session_b.flush().await.unwrap();

        let pumped = session_a
            .pump_until_quiet(Duration::from_millis(100))
            .await
            .unwrap();
        assert!(pumped > 0, "device A should observe B's push #{i}");
        assert!(
            session_a.doc().get_item(&item_id).is_some(),
            "device A should apply B's item #{i}"
        );
    }

    let snap = wait_for_snapshot(&server, Uuid::parse_str(&signup.account_id).unwrap()).await;
    assert!(
        snap.up_to_op_id > 0,
        "snapshot should cover at least one op"
    );

    session_a.flush().await.unwrap();
}

#[tokio::test]
async fn fresh_device_bootstraps_from_snapshot_and_tail_via_session() {
    let state = AppState::open_in_memory()
        .await
        .unwrap()
        .with_snapshot_threshold(TEST_SNAPSHOT_THRESHOLD_OPS);
    let server = TestServer::start_with_state(state).await;
    let dek = Dek::generate();
    let signup = signup_via_http(&server, &dek, "snapshot-bootstrap-a").await;
    let device_b = register_device(&server, &signup.device_token, "snapshot-bootstrap-b").await;
    let device_c = register_device(&server, &signup.device_token, "snapshot-bootstrap-c").await;

    let tmp_a = tempfile::tempdir().unwrap();
    let tmp_b = tempfile::tempdir().unwrap();
    let tmp_c = tempfile::tempdir().unwrap();
    let profile_a = materialize_profile(
        tmp_a.path(),
        &server.base,
        &signup.account_id,
        &signup.device_id,
        &signup.device_token,
        &dek,
        "snapshot-bootstrap@example.com",
        true,
    );
    materialize_profile(
        tmp_b.path(),
        &server.base,
        &signup.account_id,
        &device_b.device_id,
        &device_b.device_token,
        &dek,
        "snapshot-bootstrap@example.com",
        false,
    );
    let profile_c = materialize_profile(
        tmp_c.path(),
        &server.base,
        &signup.account_id,
        &device_c.device_id,
        &device_c.device_token,
        &dek,
        "snapshot-bootstrap@example.com",
        false,
    );

    let mut session_a = Session::open_with_profile(profile_a, true).await.unwrap();
    assert!(session_a.is_online(), "device A should stay connected");
    session_a
        .pump_until_quiet(Duration::from_millis(50))
        .await
        .unwrap();

    let mut first_item = None;
    for i in 0..=TEST_SNAPSHOT_THRESHOLD_OPS {
        let profile_b = reopen_profile(tmp_b.path());
        let session_b = Session::open_with_profile(profile_b, true).await.unwrap();
        let item_id = session_b
            .doc()
            .add_item(LIST_MAIN, &format!("from-b-{i}"))
            .unwrap();
        first_item.get_or_insert(item_id.clone());
        session_b.flush().await.unwrap();

        let pumped = session_a
            .pump_until_quiet(Duration::from_millis(100))
            .await
            .unwrap();
        assert!(pumped > 0, "device A should observe B's push #{i}");
    }

    let snapshot = wait_for_snapshot(&server, Uuid::parse_str(&signup.account_id).unwrap()).await;
    assert!(snapshot.up_to_op_id > 0);

    let profile_b = reopen_profile(tmp_b.path());
    let session_b = Session::open_with_profile(profile_b, true).await.unwrap();
    let tail_item = session_b
        .doc()
        .add_item(LIST_MAIN, "tail-after-snapshot")
        .unwrap();
    session_b.flush().await.unwrap();
    let pumped = session_a
        .pump_until_quiet(Duration::from_millis(100))
        .await
        .unwrap();
    assert!(pumped > 0, "device A should observe the tail op too");

    let session_c = Session::open_with_profile(profile_c, true).await.unwrap();
    assert!(session_c.is_online());
    assert!(
        session_c
            .doc()
            .get_item(first_item.as_ref().unwrap())
            .is_some(),
        "snapshot bootstrap should load pre-snapshot history"
    );
    assert_eq!(
        session_c.doc().get_item(&tail_item).unwrap().text,
        "tail-after-snapshot"
    );
    session_c.flush().await.unwrap();
    session_a.flush().await.unwrap();
}

async fn wait_for_snapshot(server: &TestServer, account_id: Uuid) -> queries::LatestSnapshot {
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        if let Some(snap) = queries::latest_snapshot(&server.state.db, account_id)
            .await
            .unwrap()
        {
            return snap;
        }
        if std::time::Instant::now() > deadline {
            panic!("snapshot never landed");
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}
