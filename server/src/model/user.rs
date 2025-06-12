use argon2::{
    Argon2, PasswordVerifier,
    password_hash::{PasswordHash, PasswordHasher, SaltString, rand_core::OsRng},
};
use serde::Serialize;
use sqlx::{SqlitePool, types::Uuid as SqlxUuid};
use uuid::Uuid;

use crate::error::AppError;

#[derive(sqlx::FromRow, Debug)]
pub struct User {
    pub id: SqlxUuid,
    pub email: String,
    pub password_hash: String,
}

#[derive(Serialize, Debug)]
pub struct PublicUser {
    pub id: String,
    pub email: String,
}

impl From<User> for PublicUser {
    fn from(user: User) -> Self {
        Self {
            id: user.id.to_string(),
            email: user.email,
        }
    }
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

pub async fn get_by_email(pool: &SqlitePool, email: &str) -> Result<Option<User>, AppError> {
    let result = sqlx::query_as!(
        User,
        r#"
        SELECT id as "id: Uuid", email, password_hash
        FROM user
        WHERE email = ?
        "#,
        email
    )
    .fetch_optional(pool)
    .await;

    match result {
        Ok(user) => Ok(user),
        Err(e) => Err(AppError::DatabaseError(e.to_string())),
    }
}

pub async fn verify_login(
    pool: &SqlitePool,
    email: &str,
    password: &str,
) -> Result<User, AppError> {
    let user = get_by_email(pool, email).await?;
    match user {
        Some(user) => {
            verify_password(&user.password_hash, password)?;
            Ok(user)
        }
        None => Err(AppError::ValidationError(String::from("User not found"))),
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

fn verify_password(password_hash: &str, password: &str) -> Result<(), AppError> {
    let password: &[u8] = password.as_bytes();
    // TODO: Forward system errors
    let parsed_hash = PasswordHash::new(&password_hash)
        .map_err(|e| AppError::ServerError(String::from("Password hash could not be parsed.")))?;
    let ok = Argon2::default()
        .verify_password(password, &parsed_hash)
        .is_ok();
    if ok {
        return Ok(());
    } else {
        return Err(AppError::ValidationError(String::from(
            "Incorrect password",
        )));
    }
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
        let user = create(&pool, email, password).await.unwrap();
        assert_eq!(user.email, email);
        assert!(!user.password_hash.is_empty());
        assert_ne!(user.password_hash, password);
        assert!(user.password_hash.starts_with("$argon2"));
    }

    #[tokio::test]
    async fn test_verify_password() {
        let pool = test_util::create_test_pool().await;
        let email = "pw_test@air.day";
        let password = "abcd12375kajsflaks";
        let user = create(&pool, email, password).await.unwrap();
        verify_password(&user.password_hash, password).unwrap();
        assert!(verify_password(&user.password_hash, "wrongpassword").is_err())
    }
}
