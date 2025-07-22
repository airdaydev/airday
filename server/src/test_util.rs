use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{
    auth::session::{ClientMeta, UserSession},
    common::sql::Db,
    user::model::User,
};

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
