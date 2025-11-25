use crate::{
    auth::{meta::ClientMeta, session::UserSession},
    common::sql::Db,
    sync::engine::IncomingSyncOp,
    user::model::User,
};
use axum::body::Bytes;
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
    let user = db.user.get_by_id(&user_id).await.unwrap().unwrap();
    UserSession::new(
        &db,
        user,
        ClientMeta {
            ip: String::from(""),
            user_agent: String::from(""),
        },
    )
    .await
    .unwrap()
}

pub fn mock_incoming_op(library_id: Uuid, obj_id: Option<Uuid>) -> IncomingSyncOp {
    IncomingSyncOp {
        op_id: Uuid::new_v4(),
        base_seq: None,
        op_kind: 0,
        // static attrs
        library_id,
        obj_kind: 0,
        obj_id: obj_id.unwrap_or(Uuid::new_v4()),
        path: 0,
        // flatbuffer
        payload: Bytes::new(),
    }
}
