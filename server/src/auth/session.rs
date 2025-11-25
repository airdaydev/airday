use crate::AppState;
use crate::auth::meta::ClientMeta;
use crate::common::error::AppError;
use crate::common::sql::Db;
use crate::user::model::User;
use async_trait::async_trait;
use axum::Json;
use axum::extract::{FromRef, FromRequestParts, State};
use axum::http::HeaderMap;
use axum::http::request::Parts;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid as SqlxUuid;
use tower_cookies::Cookies;
use uuid::Uuid;

pub enum AuthTokenKind {
    SESSION,
    REFRESH,
}

pub const SESSION_CONST: &'static str = "session";
pub const REFRESH_CONST: &'static str = "refresh";

pub fn match_token_kind(str: &str) -> Result<AuthTokenKind, AppError> {
    if str == SESSION_CONST {
        return Ok(AuthTokenKind::SESSION);
    }
    if str == REFRESH_CONST {
        return Ok(AuthTokenKind::REFRESH);
    }
    Err(AppError::ValidationError(String::from(
        "Invalid token kind",
    )))
}

#[derive(Clone, Debug)]
pub struct TokenData {
    pub session_id: Uuid,
    pub user_id: Uuid,
    pub primary_library_id: Uuid,
    pub exp: i64,
}

#[derive(Clone, Debug)]
pub enum AuthToken {
    SessionToken(TokenData),
    RefreshToken(TokenData),
}

impl AuthToken {
    pub fn new_session_token(session: &UserSession) -> Self {
        AuthToken::SessionToken(TokenData {
            session_id: session.id,
            user_id: session.user_id,
            primary_library_id: session.primary_library,
            exp: Self::get_current_timestamp() + (24 * 60 * 60), // 24 hours
        })
    }

    pub fn new_refresh_token(session: &UserSession) -> Self {
        AuthToken::RefreshToken(TokenData {
            session_id: session.id,
            user_id: session.user_id,
            primary_library_id: session.primary_library,
            exp: Self::get_current_timestamp() + (30 * 24 * 60 * 60), // 30 days
        })
    }

    fn get_current_timestamp() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    }

    pub fn data(&self) -> &TokenData {
        match self {
            AuthToken::SessionToken(data) => data,
            AuthToken::RefreshToken(data) => data,
        }
    }

    pub fn kind_str(&self) -> &'static str {
        match self {
            AuthToken::SessionToken(_) => SESSION_CONST,
            AuthToken::RefreshToken(_) => REFRESH_CONST,
        }
    }

    pub fn session_id(&self) -> Uuid {
        self.data().session_id
    }

    pub fn primary_library_id(&self) -> Uuid {
        self.data().primary_library_id
    }

    pub fn user_id(&self) -> Uuid {
        self.data().user_id
    }

    pub fn exp(&self) -> i64 {
        self.data().exp
    }
}

pub struct TokenPair {
    pub session: AuthToken,
    pub refresh: AuthToken,
}

#[derive(Clone)]
pub struct UserSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub primary_library: Uuid,
    pub client_meta: ClientMeta,
}

fn timestamp_to_datetime(timestamp: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(timestamp, 0).unwrap()
}

pub struct InsertSessionParams {
    pub id: Uuid,
    pub user_id: SqlxUuid,
    pub client_meta: ClientMeta,
}

#[async_trait]
pub trait SessionModel: Send + Sync {
    async fn insert_session(&self, params: InsertSessionParams) -> Result<(), AppError>;
    async fn get_by_user(&self, user_id: Uuid) -> Result<Vec<UserSession>, AppError>;
    async fn get_by_id(&self, session_id: Uuid) -> Result<Option<UserSession>, AppError>;
}

impl UserSession {
    pub async fn new(db: &Db, user: User, client_meta: ClientMeta) -> Result<Self, AppError> {
        let sqlx_user_id = SqlxUuid::from_bytes(user.id.into_bytes());

        let uuid = Uuid::new_v4();
        let session_id = SqlxUuid::from_bytes(uuid.into_bytes());

        db.session
            .insert_session(InsertSessionParams {
                id: session_id,
                user_id: sqlx_user_id,
                client_meta: client_meta.clone(),
            })
            .await?;

        Ok(UserSession {
            id: session_id,
            user_id: user.id,
            primary_library: user.primary_library.id,
            client_meta,
        })
    }

    pub async fn refresh(db: &Db, session: UserSession) -> Result<Self, AppError> {
        // Generate new tokens
        let token = gen_token();
        let new_refresh_token = gen_token();
        let refresh_token_hash = hash_password(&new_refresh_token)?;

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
    let session_cookie = build_session_cookie(state.config.clone(), &session);
    cookies.add(session_cookie);
    let refresh_cookie = build_refresh_cookie(state.config.clone(), &session);
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

            // TODO: deserialise paseto

            let session = app_state
                .db
                .session
                .get_token(&token)
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
