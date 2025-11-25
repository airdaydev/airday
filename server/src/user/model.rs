use crate::{
    common::{error::AppError, sql::Db},
    library::model::Library,
};
use argon2::{
    Argon2, PasswordVerifier,
    password_hash::{PasswordHash, PasswordHasher, SaltString, rand_core::OsRng},
};
use async_trait::async_trait;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid as SqlxUuid;
use uuid::Uuid;

// #[derive(Debug, Serialize, Deserialize)]
// #[serde(untagged)]
// pub enum LibraryUpdate {
//     Set(Uuid),
//     Unset,
// }

// TODO: Remove primary _library_id as a user modifiable object
#[derive(Debug, Serialize, Deserialize)]
pub struct UserAttributes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

#[async_trait]
pub trait UserModel: Send + Sync {
    async fn get_by_email(&self, email: &str) -> Result<Option<User>, AppError>;
    async fn create(&self, email: &str, password: &str) -> Result<User, AppError>;
    async fn get_by_id(&self, id: &Uuid) -> Result<Option<User>, AppError>;
    // async fn update_user(&self, user_id: &Uuid, attributes: UserAttributes)
    // -> Result<(), AppError>;
}

#[derive(sqlx::FromRow, Debug, Clone)]
pub struct User {
    pub id: SqlxUuid,
    pub email: String,
    pub password_hash: String,
    pub primary_library: Library,
}

#[derive(Serialize, Debug)]
pub struct PublicUser {
    pub id: String,
    pub email: String,
    pub primary_library: Library,
}

impl From<User> for PublicUser {
    fn from(user: User) -> Self {
        Self {
            id: user.id.to_string(),
            email: user.email,
            primary_library: user.primary_library,
        }
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

pub fn verify_password(password_hash: &str, password: &str) -> Result<(), AppError> {
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

pub async fn update_user_handler(// State(state): State<AppState>,
    // session: UserSession,
    // Json(payload): Json<UserAttributes>,
) -> Result<StatusCode, AppError> {
    // state.db.user.update_user(&session.user_id, payload).await?;
    Ok(StatusCode::NOT_IMPLEMENTED)
}
