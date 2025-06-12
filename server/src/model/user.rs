use argon2::{
    Argon2,
    password_hash::{PasswordHasher, SaltString, rand_core::OsRng},
};
use sqlx::{Result as SQLXResult, SqlitePool, sqlite::SqliteQueryResult};

use crate::error::AppError;

pub async fn create(
    pool: &SqlitePool,
    email: &str,
    password: &str,
) -> SQLXResult<SqliteQueryResult, AppError> {
    let password_hash = hash_password(password)?;
    let q = sqlx::query!(
        r#"
  INSERT INTO user (email, pw_hash) VALUES (?, ?)
  "#,
        email,
        password_hash
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

fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);

    let password: &[u8] = password.as_bytes();

    // Argon2 with default params (Argon2id v19)
    let argon2 = Argon2::default();

    // Hash password to PHC string ($argon2id$v=19$...)
    let password_hash = argon2
        .hash_password(password, &salt)
        .map_err(|e| AppError::ServerError(format!("Password hashing failed: {}", e)))?;

    Ok(password_hash.to_string())
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
