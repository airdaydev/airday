use crate::{
    auth::session::{ClientMeta, UserSession},
    common::sql::Db,
    sync_engine::engine::SyncOp,
    user::model::User,
};
use sqlx::SqlitePool;
use uuid::Uuid;

pub async fn create_test_db() -> Db {
    let pool = SqlitePool::connect(":memory:")
        .await
        .expect("Failed to create test pool");
    sqlx::migrate!("../sqlite/migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations");

    Db::from_sqlite_pool(pool)
}

pub async fn mock_user(db: &Db, email: String) -> User {
    db.user.create(&email, "test").await.unwrap()
}

pub async fn mock_session(db: &Db, user_id: Uuid) -> UserSession {
    UserSession::new(
        &db,
        user_id,
        ClientMeta {
            ip: String::from(""),
            user_agent: String::from(""),
        },
    )
    .await
    .unwrap()
}

// TODO: Distinguish incoming vs server-sourced
// pub fn mock_full_item_op(library_id: Uuid, id: Option<Uuid>) -> SyncOp {
//     SyncOp {
//         seq: 0, // Do better
//         base_seq: None,
//         op_kind: 0,
//         // static attrs
//         library_id,
//         obj_kind: 0,
//         obj_id: id.unwrap_or(Uuid::new_v4()),
//         path: None,
//         // flatbuffer
//         payload: vec![],
//         payload_sha256: None,
//         // metadata
//         tombstone_utc: None,
//         created_utc: None,
//         client_id: None,
//     }
// }
