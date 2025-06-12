use argon2::{
    Argon2,
    password_hash::{PasswordHasher, SaltString, rand_core::OsRng},
};
use sqlx::{SqlitePool, types::Uuid as SqlxUuid};
use uuid::Uuid;

use crate::error::AppError;

#[derive(sqlx::FromRow, Debug)]
pub struct User {
    pub id: SqlxUuid,
    pub email: String,
    pub password_hash: String,
}

pub async fn create(pool: &SqlitePool, email: &str, password: &str) -> Result<User, AppError> {
    let password_hash = hash_password(password)?;
    let uuid = Uuid::new_v4();
    let sqlx_uuid = SqlxUuid::from_bytes(uuid.into_bytes());
    let result = sqlx::query_as!(
        User,
        r#"
  INSERT INTO user (id, email, password_hash) VALUES (?, ?, ?) RETURNING id as "id: Uuid", email, password_hash
  "#,
        sqlx_uuid,
        email,
        password_hash
    )
    .fetch_one(pool)
    .await;
    match result {
        Ok(user) => Ok(user),
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
        let email = "daniel@air.day";
        let password = "abcd12375kajsflaks";
        let user = create(&pool, email, "abcd12375kajsflaks").await.unwrap();
        assert_eq!(user.email, email);
        assert!(!user.password_hash.is_empty());
        assert_ne!(user.password_hash, password);
        assert!(user.password_hash.starts_with("$argon2"));
    }
}
