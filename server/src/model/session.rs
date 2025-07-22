use crate::AppState;
use crate::common::datetime::serialize_datetime_iso;
use crate::common::sql::Db;
use crate::model::auth::{build_refresh_cookie, build_session_cookie};
use crate::{common::error::AppError, model::user};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use async_trait::async_trait;
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

pub struct TokenRefresh {
    token: String,
    expires: i64,
    refresh_token_hash: String,
    refresh_expires: i64,
}

pub struct InsertSessionParams {
    id: Uuid,
    token: String,
    expires: i64,
    refresh_token_hash: String,
    refresh_expires: i64,
    sqlx_user_id: SqlxUuid,
    client_meta: ClientMeta,
}

#[async_trait]
pub trait SessionModel: Send + Sync {
    // TODO: Consider encapsulating these in struct
    async fn insert_session(&self, params: InsertSessionParams) -> Result<(), AppError>;
    async fn get_by_user(&self, user_id: Uuid) -> Result<Vec<UserSession>, AppError>;
    async fn get_by_id(&self, id: Uuid) -> Result<Option<UserSession>, AppError>;
    async fn update_token(
        &self,
        session_id: Uuid,
        token_refresh: &TokenRefresh,
    ) -> Result<(), AppError>;
    async fn get_by_token(&self, token: &str) -> Result<Option<UserSession>, AppError>;
}

pub struct SessionModelSqlite {
    pool: SqlitePool,
}

impl SessionModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SessionModel for SessionModelSqlite {
    async fn insert_session(&self, params: InsertSessionParams) -> Result<(), AppError> {
        sqlx::query!(
          r#"
          INSERT INTO session (id, token, expires, refresh_token, refresh_expires, user_id, user_agent, ip)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          "#,
          params.id,
          params.token,
          params.expires,
          params.refresh_token_hash,
          params.refresh_expires,
          params.sqlx_user_id,
          params.client_meta.user_agent,
          params.client_meta.ip
      )
      .execute(&self.pool)
      .await
      .map_err(|err| AppError::from(err))?;
        Ok(())
    }
    async fn get_by_user(&self, user_id: Uuid) -> Result<Vec<UserSession>, AppError> {
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
        .fetch_all(&self.pool)
        .await
        .map_err(|err| AppError::from(err))?;

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
    async fn get_by_id(&self, id: Uuid) -> Result<Option<UserSession>, AppError> {
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
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| AppError::from(err))?;

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
    async fn update_token(
        &self,
        session_id: Uuid,
        token_refresh: &TokenRefresh,
    ) -> Result<(), AppError> {
        sqlx::query!(
            r#"
          UPDATE session
          SET token = ?, expires = ?, refresh_token = ?, refresh_expires = ?
          WHERE id = ?
          "#,
            token_refresh.token,
            token_refresh.expires,
            token_refresh.refresh_token_hash,
            token_refresh.refresh_expires,
            session_id,
        )
        .execute(&self.pool)
        .await
        .map_err(|err| AppError::from(err))?;
        Ok(())
    }
    async fn get_by_token(&self, token: &str) -> Result<Option<UserSession>, AppError> {
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
        .fetch_optional(&self.pool)
        .await
        .map_err(|err| AppError::from(err))?;

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
    pub async fn new(db: &Db, user_id: Uuid, client_meta: ClientMeta) -> Result<Self, AppError> {
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

        db.session
            .insert_session(InsertSessionParams {
                id: id,
                token: token.clone(),
                expires: expires,
                refresh_token_hash: refresh_token_hash,
                refresh_expires: refresh_expires,
                sqlx_user_id: sqlx_user_id,
                client_meta: client_meta,
            })
            .await?;

        Ok(UserSession {
            id,
            token,
            expires: expires_datetime,
            refresh_token,
            refresh_expires: refresh_expires_datetime,
            user_id,
        })
    }

    pub async fn refresh(db: &Db, session: UserSession) -> Result<Self, AppError> {
        // Generate new tokens
        let token = gen_token();
        let new_refresh_token = gen_token();
        let refresh_token_hash = user::hash_password(&new_refresh_token)?;

        // Calculate expiration times (24 hours for session, 30 days for refresh token)
        let now = get_current_timestamp();
        let expires = calculate_session_expiry(now);
        let refresh_expires = calculate_refresh_expiry(now);

        let refresh = TokenRefresh {
            token,
            expires,
            refresh_token_hash,
            refresh_expires,
        };
        // Update existing session with new tokens
        db.session.update_token(session.id, &refresh).await?;

        Ok(UserSession {
            id: session.id,
            token: refresh.token.clone(),
            expires: timestamp_to_datetime(expires),
            refresh_token: new_refresh_token,
            refresh_expires: timestamp_to_datetime(refresh_expires),
            user_id: session.user_id,
        })
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
    let sessions = state.db.session.get_by_user(session.id).await?;
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
    db: &Db,
    user_id: Uuid,
    refresh_token: &str,
) -> Result<UserSession, AppError> {
    let refresh_token: &[u8] = refresh_token.as_bytes();
    let old_session = match db.session.get_by_id(user_id).await? {
        Some(session) => session,
        None => {
            return Err(AppError::AuthorisationError(String::from(
                "Invalid session id errr",
            )));
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
    let session = UserSession::refresh(db, old_session).await?;
    Ok(session)
}

pub async fn refresh_session_bearer(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<RefreshSessionReq>,
) -> Result<Json<UserSession>, AppError> {
    let refresh_token = extract_bearer_token(&headers).ok_or(AppError::AuthorisationError(
        String::from("No refresh token"),
    ))?;
    let sqlx_user_id = SqlxUuid::parse_str(&payload.id)
        .map_err(|_| AppError::ValidationError(String::from("Invalid user ID format")))?;
    let session = refresh_if_valid(&state.db, sqlx_user_id, &refresh_token).await?;
    Ok(Json(session))
}

pub async fn refresh_session_cookie(
    State(state): State<AppState>,
    cookies: Cookies,
    Json(payload): Json<RefreshSessionReq>,
) -> Result<Json<UserSession>, AppError> {
    let refresh_token = extract_cookie(&cookies, String::from("refresh_token")).ok_or(
        AppError::AuthorisationError(String::from("No refresh token")),
    )?;
    let sqlx_user_id = SqlxUuid::parse_str(&payload.id)
        .map_err(|_| AppError::ValidationError(String::from("Invalid user ID format")))?;
    let session = refresh_if_valid(&state.db, sqlx_user_id, &refresh_token).await?;
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

            let session = app_state
                .db
                .session
                .get_by_token(&token)
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
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("test_session_crud@air.day")).await;
        let session = mock_session(&db, user.id).await;
        let refreshed_session = UserSession::refresh(&db, session.clone()).await.unwrap();
        assert_eq!(session.id, refreshed_session.id);
        assert_ne!(session.token, refreshed_session.token);
        assert_ne!(session.refresh_token, refreshed_session.refresh_token);
        let existing_session = db.session.get_by_id(session.id).await.unwrap();
        assert!(existing_session.is_some());
    }
}
