use sqlx::SqlitePool;
use uuid::Uuid;

use crate::model::{
    session::{ClientMeta, UserSession},
    user::{self, User},
};

pub async fn create_test_pool() -> SqlitePool {
    let pool = SqlitePool::connect(":memory:")
        .await
        .expect("Failed to create test pool");
    sqlx::migrate!("../migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations");

    pool
}

pub async fn mock_user(pool: &SqlitePool, email: String) -> User {
    user::create(pool, &email, "test").await.unwrap()
}

pub async fn mock_session(pool: &SqlitePool, user_id: Uuid) -> UserSession {
    UserSession::new(
        &pool,
        user_id,
        ClientMeta {
            ip: "".to_string(),
            user_agent: "".to_string(),
        },
    )
    .await
    .unwrap()
}
