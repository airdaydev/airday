use crate::{common::error::AppError, model::user};
use base64::{Engine as _, engine::general_purpose};
use rand::{TryRngCore, rngs::OsRng};
use sqlx::SqlitePool;
use sqlx::types::Uuid as SqlxUuid;
use uuid::Uuid;

pub struct UserSession {
    pub id: String,
    pub refresh_token: String,
}

pub fn gen_session_id() -> String {
    let mut rng = OsRng; // CSPRNG
    let mut bytes = [0u8; 20]; // 160 bits of entropy (OAuth 2 recommendation)
    rng.try_fill_bytes(&mut bytes).unwrap();
    general_purpose::URL_SAFE_NO_PAD.encode(&bytes) // Base64 encoded
}

impl UserSession {
    pub async fn new(
        pool: &SqlitePool,
        user_id: Uuid,
        headers: &axum::http::HeaderMap,
    ) -> Result<Self, AppError> {
        let session_id = gen_session_id();
        let refresh_token = gen_session_id();
        let refresh_token_hash = user::hash_password(&refresh_token)?;

        // Extract user agent and IP from headers
        let user_agent = headers
            .get("user-agent")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("Unknown")
            .to_string();

        let ip = headers
            .get("x-forwarded-for")
            .or_else(|| headers.get("x-real-ip"))
            .and_then(|h| h.to_str().ok())
            .unwrap_or("Unknown")
            .to_string();

        // Calculate expiration times (24 hours for session, 30 days for refresh token)
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let expires = now + (24 * 60 * 60); // 24 hours
        let refresh_token_expires = now + (30 * 24 * 60 * 60); // 30 days

        let sqlx_user_id = SqlxUuid::from_bytes(user_id.into_bytes());

        // Save session to database
        sqlx::query!(
            r#"
            INSERT INTO session (id, expires, refresh_token, refresh_token_expires, user_id, user_agent, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
            session_id,
            expires,
            refresh_token_hash,
            refresh_token_expires,
            sqlx_user_id,
            user_agent,
            ip
        )
        .execute(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        Ok(UserSession {
            id: session_id,
            refresh_token,
        })
    }

    pub async fn get_by_id(
        pool: &SqlitePool,
        session_id: &str,
    ) -> Result<Option<UserSession>, AppError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let result = sqlx::query!(
            r#"
            SELECT id, refresh_token
            FROM session
            WHERE id = ? AND expires > ?
            "#,
            session_id,
            now
        )
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        match result {
            Some(row) => Ok(Some(UserSession {
                id: row.id,
                refresh_token: row.refresh_token,
            })),
            None => Ok(None),
        }
    }
}
