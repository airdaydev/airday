// TODO: This will initially handle session based authentication
// via both a bearer token and cookie
use crate::{
    AppState,
    common::error::AppError,
    model::{self, user::verify_login},
};
use axum::{
    extract::Request, extract::State, http::StatusCode, middleware::Next, response::Json,
    response::Response,
};
use base64::{Engine as _, engine::general_purpose};
use rand::{TryRngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use sqlx::types::Uuid as SqlxUuid;
use tower_cookies::{Cookie, Cookies};
use uuid::Uuid;

fn gen_session_id() -> String {
    let mut rng = OsRng; // CSPRNG
    let mut bytes = [0u8; 20]; // 160 bits of entropy (OAuth 2 recommendation)
    rng.try_fill_bytes(&mut bytes).unwrap();
    general_purpose::URL_SAFE_NO_PAD.encode(&bytes) // Base64 encoded
}

#[derive(Serialize)]
pub struct PwdAuthResponse {
    result: &'static str,
}

impl Default for PwdAuthResponse {
    fn default() -> Self {
        Self {
            result: "Authorized",
        }
    }
}

#[derive(Deserialize)]
pub struct PasswordAuthorisationReq {
    pub email: String,
    pub password: String,
}

pub struct UserSession {
    id: String,
    refresh_token: String,
}

impl UserSession {
    pub async fn new(
        pool: &SqlitePool,
        user_id: Uuid,
        headers: &axum::http::HeaderMap,
    ) -> Result<Self, AppError> {
        let session_id = gen_session_id();
        let refresh_token = gen_session_id();
        let refresh_token_hash = model::user::hash_password(&refresh_token)?;

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

pub async fn password_authorisation(
    State(state): State<AppState>,
    cookies: Cookies,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PasswordAuthorisationReq>,
) -> Result<Json<PwdAuthResponse>, AppError> {
    let user = verify_login(&state.pool, &payload.email, &payload.password).await?;
    let user_uuid = Uuid::from_bytes(user.id.into_bytes());
    let session = UserSession::new(&state.pool, user_uuid, &headers).await?;
    let cookie = Cookie::build(("session_id", session.id))
        .http_only(true)
        // .secure(true)
        .same_site(tower_cookies::cookie::SameSite::Strict)
        .path("/")
        .max_age(tower_cookies::cookie::time::Duration::hours(24))
        .build();
    cookies.add(cookie);
    Ok(Json(PwdAuthResponse::default()))
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    cookies: Cookies,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if let Some(session_cookie) = cookies.get("session_id") {
        match UserSession::get_by_id(&state.pool, session_cookie.value()).await {
            Ok(Some(_session)) => Ok(next.run(request).await),
            Ok(None) => Err(StatusCode::UNAUTHORIZED),
            Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
        }
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct CreateUserResponse {
    id: String,
}

pub async fn create_user(
    State(state): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<Json<CreateUserResponse>, AppError> {
    let email = payload.email;
    let password = payload.password;
    let user = model::user::create(&state.pool, &email, &password).await;
    user.map(|u| {
        Json(CreateUserResponse {
            id: u.id.to_string(),
        })
    })
}
