use crate::{AppState, model};
use crate::{common::error::AppError, model::user};
use axum::extract::{FromRef, FromRequestParts};
use axum::http::StatusCode;
use axum::http::request::Parts;
use base64::{Engine as _, engine::general_purpose};
use rand::{TryRngCore, rngs::OsRng};
use serde::Serialize;
use sqlx::SqlitePool;
use sqlx::types::Uuid as SqlxUuid;
use uuid::Uuid;

#[derive(Clone)]
pub struct UserSession {
    pub id: String,
    pub token: String,
    pub refresh_token: String,
}

pub fn gen_token() -> String {
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
        let token = gen_token();
        let refresh_token = gen_token();
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

        let uuid = Uuid::new_v4();
        let id = SqlxUuid::from_bytes(uuid.into_bytes());

        // Save session to database
        sqlx::query!(
            r#"
            INSERT INTO session (id, token, expires, refresh_token, refresh_token_expires, user_id, user_agent, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            id,
            token,
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
            id: id.to_string(),
            token,
            refresh_token,
        })
    }

    pub async fn get_by_id(
        pool: &SqlitePool,
        token: &str,
    ) -> Result<Option<UserSession>, AppError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let result = sqlx::query!(
            r#"
            SELECT id as "id: Uuid", token, refresh_token
            FROM session
            WHERE id = ? AND expires > ?
            "#,
            token,
            now
        )
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        match result {
            Some(row) => Ok(Some(UserSession {
                id: row.id.to_string(),
                token: row.id.to_string(),
                refresh_token: row.refresh_token,
            })),
            None => Ok(None),
        }
    }

    pub async fn get_by_user(
        pool: &SqlitePool,
        user_id: String,
    ) -> Result<Vec<UserSession>, AppError> {
        let sqlx_user_id = SqlxUuid::parse_str(&user_id)
            .map_err(|_| AppError::DatabaseError("Invalid user ID format".to_string()))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let results = sqlx::query!(
            r#"
        SELECT id as "id: Uuid", token, refresh_token
        FROM session
        WHERE user_id = ? AND expires > ?
        "#,
            sqlx_user_id,
            now
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        let sessions: Vec<UserSession> = results
            .into_iter()
            .map(|row| UserSession {
                id: row.id.to_string(),
                token: row.token,
                refresh_token: row.refresh_token,
            })
            .collect();

        Ok(sessions)
    }
}

#[derive(Serialize)]
pub struct GetUserSessionsResponse {
    id: String,
}

// pub async fn get_user_sessions(
//     State(state): State<AppState>,
// ) -> Result<Json<GetUserSessionsResponse>, AppError> {
//     let user = model::session::get_user_sessions(&state.pool, &email, &password).await;
//     user.map(|u| {
//         Json(GetUserSessionsResponse {
//             id: u.id.to_string(),
//         })
//     })
// }

pub struct AuthenticatedSession {
    pub session: model::session::UserSession,
}

// impl<S> FromRequestParts<S> for AuthenticatedSession
// where
//     S: Send + Sync,
//     AppState: FromRef<S>,
// {
//     type Rejection = StatusCode;

//     fn from_request_parts(
//         parts: &mut Parts,
//         state: &S,
//     ) -> impl Future<Output = Result<Self, Self::Rejection>> + Send {
//     }
// }
