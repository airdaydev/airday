use sqlx::{Result, SqlitePool, sqlite::SqliteQueryResult};

use crate::error::AppError;

pub async fn create(
    pool: &SqlitePool,
    username: &str,
    _password: &str,
) -> Result<SqliteQueryResult, AppError> {
    let q = sqlx::query!(
        r#"
  INSERT INTO user (username, pw_hash) VALUES (?, "bzz")
  "#,
        username
    )
    .execute(pool)
    .await;
    match q {
        Ok(result) => Ok(result),
        Err(sqlx::Error::Database(db_err)) => {
            if db_err.is_unique_violation() {
                Err(AppError::ValidationError(String::from(
                    "A user with this email already exists.",
                )))
            } else {
                Err(AppError::DatabaseError(db_err.to_string()))
            }
        }
        Err(e) => Err(AppError::DatabaseError(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util;

    #[tokio::test]
    async fn test_create_user() {
        let pool = test_util::create_test_pool().await;
        let b = create(&pool, "test", "tite").await.unwrap();
        assert!(b.last_insert_rowid() > 0);
    }
}
