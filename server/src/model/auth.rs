use crate::{
    AppState,
    common::error::AppError,
    model::{self, user::verify_login},
};
use axum::{
    extract::Request, extract::State, http::StatusCode, middleware::Next, response::Json,
    response::Response,
};
use serde::{Deserialize, Serialize};
use tower_cookies::{Cookie, Cookies};
use uuid::Uuid;

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

pub async fn password_authorisation(
    State(state): State<AppState>,
    cookies: Cookies,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PasswordAuthorisationReq>,
) -> Result<Json<PwdAuthResponse>, AppError> {
    let user = verify_login(&state.pool, &payload.email, &payload.password).await?;
    let user_uuid = Uuid::from_bytes(user.id.into_bytes());
    let session = model::session::UserSession::new(&state.pool, user_uuid, &headers).await?;
    let cookie = Cookie::build(("session_token", session.token))
        .http_only(true)
        .secure(state.config.secure_cookies)
        .same_site(tower_cookies::cookie::SameSite::Strict)
        .path("/")
        .max_age(tower_cookies::cookie::time::Duration::hours(24))
        .build();
    cookies.add(cookie);
    let refresh_cookie = Cookie::build(("refresh_token", session.refresh_token))
        .http_only(true)
        .secure(state.config.secure_cookies)
        .same_site(tower_cookies::cookie::SameSite::Strict)
        .path("/auth/refresh")
        .max_age(tower_cookies::cookie::time::Duration::days(120))
        .build();
    cookies.add(refresh_cookie);
    Ok(Json(PwdAuthResponse::default()))
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    cookies: Cookies,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if let Some(session_cookie) = cookies.get("session_id") {
        match model::session::UserSession::get_by_id(&state.pool, session_cookie.value()).await {
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
