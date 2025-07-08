use crate::common::{error::AppError, sql::Db};
use argon2::{
    Argon2, PasswordVerifier,
    password_hash::{PasswordHash, PasswordHasher, SaltString, rand_core::OsRng},
};
use async_trait::async_trait;
use serde::Serialize;
use sqlx::{SqlitePool, types::Uuid as SqlxUuid};
use uuid::Uuid;

#[async_trait]
pub trait UserModel: Send + Sync {
    async fn get_by_email(&self, email: &str) -> Result<Option<User>, AppError>;
    async fn create(&self, email: &str, password: &str) -> Result<User, AppError>;
}

pub struct UserModelSqlite {
    pool: SqlitePool,
}

#[async_trait]
impl UserModel for UserModelSqlite {
    async fn get_by_email(&self, email: &str) -> Result<Option<User>, AppError> {
        let result = sqlx::query_as!(
            User,
            r#"
          SELECT id as "id: Uuid", email, password_hash
          FROM user
          WHERE email = ?
          "#,
            email
        )
        .fetch_optional(&self.pool)
        .await;

        match result {
            Ok(user) => Ok(user),
            Err(e) => Err(AppError::DatabaseError(e.to_string())),
        }
    }
    async fn create(&self, email: &str, password: &str) -> Result<User, AppError> {
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
        .fetch_one(&self.pool)
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
}

impl UserModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

// impl UserModel {
//   pub fn verify_login()
// }

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

pub async fn get_by_id(pool: &SqlitePool, id: &Uuid) -> Result<Option<User>, AppError> {
    let sqlx_uuid = SqlxUuid::from_bytes(id.into_bytes());
    let result = sqlx::query_as!(
        User,
        r#"
        SELECT id as "id: Uuid", email, password_hash
        FROM user
        WHERE id = ?
        "#,
        sqlx_uuid
    )
    .fetch_optional(pool)
    .await;

    match result {
        Ok(user) => Ok(user),
        Err(e) => Err(AppError::DatabaseError(e.to_string())),
    }
}

pub async fn verify_login(db: &Db, email: &str, password: &str) -> Result<User, AppError> {
    let user = db.user.get_by_email(email).await?;
    match user {
        Some(user) => {
            verify_password(&user.password_hash, password)?;
            Ok(user)
        }
        None => Err(AppError::ValidationError(String::from("User not found"))),
    }
}

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let password: &[u8] = password.as_bytes();
    // Argon2 with default params (Argon2id v19)
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password, &salt)
        .map_err(|e| AppError::ServerError(format!("Password hashing failed: {}", e)))?;
    Ok(password_hash.to_string())
}

fn verify_password(password_hash: &str, password: &str) -> Result<(), AppError> {
    let password: &[u8] = password.as_bytes();
    // TODO: Forward system errors
    let parsed_hash = PasswordHash::new(&password_hash)
        .map_err(|_| AppError::ServerError(String::from("Password hash could not be parsed.")))?;
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
        let db = test_util::create_test_db().await;
        let email = "daniel@air.day";
        let password = "abcd12375kajsflaks";
        let user = create(&db, email, password).await.unwrap();
        assert_eq!(user.email, email);
        assert!(!user.password_hash.is_empty());
        assert_ne!(user.password_hash, password);
        assert!(user.password_hash.starts_with("$argon2"));
    }

    #[tokio::test]
    async fn test_verify_password() {
        let db = test_util::create_test_db().await;
        let email = "pw_test@air.day";
        let password = "abcd12375kajsflaks";
        let user = create(&db, email, password).await.unwrap();
        verify_password(&user.password_hash, password).unwrap();
        assert!(verify_password(&user.password_hash, "wrongpassword").is_err())
    }

    #[tokio::test]
    async fn test_get_user_by_id() {
        let db = test_util::create_test_db().await;
        let email = "id_test@air.day";
        let password = "abcd12375kajsflaks";
        let user = create(&db, email, password).await.unwrap();

        let user_id = Uuid::from_bytes(user.id.into_bytes());
        let found_user = get_by_id(&db, &user_id).await.unwrap();

        assert!(found_user.is_some());
        let found_user = found_user.unwrap();
        assert_eq!(found_user.id, user.id);
        assert_eq!(found_user.email, email);

        // Test with non-existent ID
        let non_existent_id = Uuid::new_v4();
        let not_found = get_by_id(&db, &non_existent_id).await.unwrap();
        assert!(not_found.is_none());
    }
}
