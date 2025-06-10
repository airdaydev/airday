use sqlx::{Result, SqlitePool, sqlite::SqliteQueryResult};

pub async fn create(pool: &SqlitePool, username: &str) -> Result<SqliteQueryResult> {
    sqlx::query!(
        r#"
  INSERT INTO user (username, pw_hash) VALUES (?, "bzz")
  "#,
        username
    )
    .execute(pool)
    .await
    // TODO: UsernameExists Error!
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util;

    #[tokio::test]
    async fn test_create_user() {
        let pool = test_util::create_test_pool().await;
        let b = create(&pool, "test").await.unwrap();
        assert!(b.last_insert_rowid() > 0);
    }
}
