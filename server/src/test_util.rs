use crate::{
    auth::session::{ClientMeta, UserSession},
    common::sql::Db,
    sync_object::model::{ItemAttributes, SyncObject, SyncObjectMeta},
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

pub fn mock_item(library_id: Uuid) -> SyncObject {
    let meta = SyncObjectMeta {
        id: Uuid::new_v4(),
        library_id,
        server_seq: None,
        tombstone_utc: None,
    };
    SyncObject::Item {
        meta,
        attrs: ItemAttributes { text: None },
    }
}
