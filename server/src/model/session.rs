use crate::AppState;
use crate::common::datetime::serialize_datetime_iso;
use crate::model::auth::{build_refresh_cookie, build_session_cookie};
use crate::{common::error::AppError, model::user};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use axum::Json;
use axum::extract::{FromRef, FromRequestParts, State};
use axum::http::HeaderMap;
use axum::http::request::Parts;
use base64::{Engine as _, engine::general_purpose};
use chrono::{DateTime, Utc};
use rand::{TryRngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use sqlx::types::Uuid as SqlxUuid;
use tower_cookies::Cookies;
use uuid::Uuid;

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UserSession {
    pub id: Uuid,
    pub token: String,
    #[serde(serialize_with = "serialize_datetime_iso")]
    pub expires: DateTime<Utc>,
    pub refresh_token: String,
    #[serde(serialize_with = "serialize_datetime_iso")]
    pub refresh_expires: DateTime<Utc>,
    pub user_id: Uuid,
}

pub fn gen_token() -> String {
    let mut rng = OsRng; // CSPRNG
    let mut bytes = [0u8; 20]; // 160 bits of entropy (OAuth 2 recommendation)
    rng.try_fill_bytes(&mut bytes).unwrap();
    general_purpose::URL_SAFE_NO_PAD.encode(&bytes) // Base64 encoded
}

fn get_current_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn calculate_session_expiry(now: i64) -> i64 {
    now + (24 * 60 * 60) // 24 hours
}

fn calculate_refresh_expiry(now: i64) -> i64 {
    now + (30 * 24 * 60 * 60) // 30 days
}

fn timestamp_to_datetime(timestamp: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(timestamp, 0).unwrap()
}

pub struct ClientMeta {
    pub ip: String,
    pub user_agent: String,
}

pub fn get_client_meta(headers: &axum::http::HeaderMap) -> ClientMeta {
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
    return ClientMeta { user_agent, ip };
}

impl UserSession {
    pub async fn new(
        pool: &SqlitePool,
        user_id: Uuid,
        client_meta: ClientMeta,
    ) -> Result<Self, AppError> {
        let token = gen_token();
        let refresh_token = gen_token();
        let refresh_token_hash = user::hash_password(&refresh_token)?;

        // Calculate expiration times (24 hours for session, 30 days for refresh token)
        let now = get_current_timestamp();
        let expires = calculate_session_expiry(now);
        let expires_datetime = timestamp_to_datetime(expires);
        let refresh_expires = calculate_refresh_expiry(now);
        let refresh_expires_datetime = timestamp_to_datetime(refresh_expires);

        let sqlx_user_id = SqlxUuid::from_bytes(user_id.into_bytes());

        let uuid = Uuid::new_v4();
        let id = SqlxUuid::from_bytes(uuid.into_bytes());

        // Save session to database
        sqlx::query!(
            r#"
            INSERT INTO session (id, token, expires, refresh_token, refresh_expires, user_id, user_agent, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            id,
            token,
            expires,
            refresh_token_hash,
            refresh_expires,
            sqlx_user_id,
            client_meta.user_agent,
            client_meta.ip
        )
        .execute(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        Ok(UserSession {
            id,
            token,
            expires: expires_datetime,
            refresh_token,
            refresh_expires: refresh_expires_datetime,
            user_id,
        })
    }

    pub async fn get_by_token(
        pool: &SqlitePool,
        token: &str,
    ) -> Result<Option<UserSession>, AppError> {
        let now = get_current_timestamp();

        let result = sqlx::query!(
            r#"
            SELECT id as "id: Uuid", token, expires as "expires: DateTime<Utc>",
            refresh_token, refresh_expires as "refresh_expires: DateTime<Utc>",
            user_id as 'user_id: Uuid'
            FROM session
            WHERE token = ? AND expires > ?
            "#,
            token,
            now
        )
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        match result {
            Some(row) => Ok(Some(UserSession {
                id: row.id,
                expires: row.expires,
                token: row.id.to_string(),
                refresh_token: row.refresh_token,
                refresh_expires: row.refresh_expires,
                user_id: row.user_id,
            })),
            None => Ok(None),
        }
    }

    pub async fn get_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<UserSession>, AppError> {
        let now = get_current_timestamp();

        let result = sqlx::query!(
            r#"
            SELECT id as "id: Uuid", token, expires as "expires: DateTime<Utc>",
            refresh_token, refresh_expires as "refresh_expires: DateTime<Utc>", user_id as 'user_id: Uuid'
            FROM session
            WHERE id = ? AND refresh_expires > ?
            "#,
            id,
            now
        )
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        match result {
            Some(row) => Ok(Some(UserSession {
                id: row.id,
                token: row.token,
                expires: row.expires,
                refresh_token: row.refresh_token,
                refresh_expires: row.refresh_expires,
                user_id: row.user_id,
            })),
            None => Ok(None),
        }
    }

    pub async fn refresh(pool: &SqlitePool, old_session: UserSession) -> Result<Self, AppError> {
        // Generate new tokens
        let token = gen_token();
        let new_refresh_token = gen_token();
        let refresh_token_hash = user::hash_password(&new_refresh_token)?;

        // Calculate expiration times (24 hours for session, 30 days for refresh token)
        let now = get_current_timestamp();
        let expires = calculate_session_expiry(now);
        let refresh_expires = calculate_refresh_expiry(now);

        // Update existing session with new tokens
        sqlx::query!(
            r#"
            UPDATE session
            SET token = ?, expires = ?, refresh_token = ?, refresh_expires = ?
            WHERE id = ?
            "#,
            token,
            expires,
            refresh_token_hash,
            refresh_expires,
            old_session.id,
        )
        .execute(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        Ok(UserSession {
            id: old_session.id,
            token,
            expires: timestamp_to_datetime(expires),
            refresh_token: new_refresh_token,
            refresh_expires: timestamp_to_datetime(refresh_expires),
            user_id: old_session.user_id,
        })
    }

    pub async fn get_by_user(
        pool: &SqlitePool,
        user_id: Uuid,
    ) -> Result<Vec<UserSession>, AppError> {
        let now = get_current_timestamp();

        let results = sqlx::query!(
            r#"
        SELECT id as "id: Uuid", token, expires as "expires: DateTime<Utc>",
        refresh_token, refresh_expires as "refresh_expires: DateTime<Utc>", user_id as 'user_id: Uuid'
        FROM session
        WHERE user_id = ? AND expires > ?
        "#,
            user_id,
            now
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        let sessions: Vec<UserSession> = results
            .into_iter()
            .map(|row| UserSession {
                id: row.id,
                token: row.token,
                expires: row.expires,
                refresh_token: row.refresh_token,
                refresh_expires: row.refresh_expires,
                user_id: row.user_id,
            })
            .collect();

        Ok(sessions)
    }
}

#[derive(Serialize)]
pub struct GetUserSessionsResponse {
    data: Vec<UserSession>,
}

pub async fn get_user_sessions(
    State(state): State<AppState>,
    session: UserSession,
) -> Result<Json<GetUserSessionsResponse>, AppError> {
    let sessions = UserSession::get_by_user(&state.pool, session.id).await?;
    Ok(Json(GetUserSessionsResponse { data: sessions }))
}

#[derive(Serialize)]
pub struct RefreshSessionResponse {
    id: String,
}

#[derive(Deserialize)]
pub struct RefreshSessionReq {
    pub id: String,
}

async fn refresh_if_valid(
    pool: &SqlitePool,
    user_id: Uuid,
    refresh_token: &str,
) -> Result<UserSession, AppError> {
    let refresh_token: &[u8] = refresh_token.as_bytes();
    let old_session = match UserSession::get_by_id(pool, user_id).await? {
        Some(session) => session,
        None => {
            return Err(AppError::AuthorisationError(
                "Invalid session id errr".to_string(),
            ));
        }
    };
    let parsed_hash = PasswordHash::new(&old_session.refresh_token)
        .map_err(|_| AppError::ServerError(String::from("Password hash could not be parsed.")))?;
    let ok = Argon2::default()
        .verify_password(refresh_token, &parsed_hash)
        .is_ok();
    if !ok {
        return Err(AppError::ValidationError(String::from("Invalid token")));
    }
    let session = UserSession::refresh(pool, old_session).await?;
    Ok(session)
}

pub async fn refresh_session_bearer(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<RefreshSessionReq>,
) -> Result<Json<UserSession>, AppError> {
    let refresh_token = extract_bearer_token(&headers)
        .ok_or(AppError::AuthorisationError("No refresh token".to_string()))?;
    let sqlx_user_id = SqlxUuid::parse_str(&payload.id)
        .map_err(|_| AppError::DatabaseError("Invalid user ID format".to_string()))?;
    let session = refresh_if_valid(&state.pool, sqlx_user_id, &refresh_token).await?;
    Ok(Json(session))
}

pub async fn refresh_session_cookie(
    State(state): State<AppState>,
    cookies: Cookies,
    Json(payload): Json<RefreshSessionReq>,
) -> Result<Json<UserSession>, AppError> {
    let refresh_token = extract_cookie(&cookies, "refresh_token".to_string())
        .ok_or(AppError::AuthorisationError("No refresh token".to_string()))?;
    let sqlx_user_id = SqlxUuid::parse_str(&payload.id)
        .map_err(|_| AppError::DatabaseError("Invalid user ID format".to_string()))?;
    let session = refresh_if_valid(&state.pool, sqlx_user_id, &refresh_token).await?;
    let session_cookie = build_session_cookie(state.config.clone(), &session.token);
    cookies.add(session_cookie);
    let refresh_cookie = build_refresh_cookie(state.config.clone(), &session.refresh_token);
    cookies.add(refresh_cookie);
    // TODO: Omit tokens
    Ok(Json(session))
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get("Authorization")
        .and_then(|value| value.to_str().ok())
        .filter(|auth| auth.starts_with("Bearer"))
        .map(|auth| auth.trim_start_matches("Bearer ").trim().to_string())
}

fn extract_cookie(cookies: &tower_cookies::Cookies, name: String) -> Option<String> {
    cookies.get(&name).map(|cookie| cookie.value().to_string())
}

async fn extract_token<S>(parts: &mut Parts, state: &S) -> Option<String>
where
    S: Send + Sync,
{
    if let Some(token) = extract_bearer_token(&parts.headers) {
        return Some(token);
    }

    let cookies_result = tower_cookies::Cookies::from_request_parts(parts, state).await;
    if let Ok(cookies) = cookies_result {
        if let Some(token) = extract_cookie(&cookies, String::from("session_token")) {
            return Some(token);
        }
    }

    None
}

impl<S> FromRequestParts<S> for UserSession
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = AppError;

    fn from_request_parts(
        parts: &mut Parts,
        state: &S,
    ) -> impl Future<Output = Result<Self, Self::Rejection>> + Send {
        async move {
            let app_state = AppState::from_ref(state);
            let token = extract_token(parts, state)
                .await
                .ok_or(AppError::AuthorisationError(String::from(
                    "no auth token found",
                )))?;

            let session = UserSession::get_by_token(&app_state.pool, &token)
                .await
                .map_err(|_| {
                    AppError::ServerError(String::from("Failed to retrieve user session db error"))
                })?
                .ok_or(AppError::AuthorisationError(String::from(
                    "no user session found",
                )))?;

            Ok(session)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{self, mock_session};

    #[tokio::test]
    async fn test_session_crud() {
        let pool = test_util::create_test_pool().await;
        let user = test_util::mock_user(&pool, "test_session_crud@air.day".to_string()).await;
        let session = mock_session(&pool, user.id).await;
        let refreshed_session = UserSession::refresh(&pool, session.clone()).await.unwrap();
        assert_eq!(session.id, refreshed_session.id);
        assert_ne!(session.token, refreshed_session.token);
        assert_ne!(session.refresh_token, refreshed_session.refresh_token);
        let existing_session = UserSession::get_by_id(&pool, session.id).await.unwrap();
        assert!(existing_session.is_some());
    }
}
