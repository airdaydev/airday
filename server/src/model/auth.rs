use crate::{
    AppState,
    common::{config::AirdayConfig, error::AppError},
    model::{self, user::verify_login},
};
use axum::{extract::State, response::Json};
use serde::{Deserialize, Serialize};
use tower_cookies::{Cookie, Cookies};
use uuid::Uuid;

#[derive(Serialize)]
pub struct PwdAuthResponse {
    id: String,
    // tokenExpiry: Date,
    // refreshTokenExpiry: Date,
}

#[derive(Deserialize)]
pub struct PasswordAuthorisationReq {
    pub email: String,
    pub password: String,
}

pub fn build_session_token(config: AirdayConfig, token: String) -> Cookie<'static> {
    Cookie::build(("session_token", token))
        .http_only(true)
        .secure(config.secure_cookies.clone())
        .same_site(tower_cookies::cookie::SameSite::Strict)
        .path("/")
        .max_age(tower_cookies::cookie::time::Duration::hours(24))
        .build()
}

pub fn build_refresh_token(config: AirdayConfig, token: String) -> Cookie<'static> {
    Cookie::build(("refresh_token", token))
        .http_only(true)
        .secure(config.secure_cookies.clone())
        .same_site(tower_cookies::cookie::SameSite::Strict)
        .path("/")
        .max_age(tower_cookies::cookie::time::Duration::days(120))
        .build()
}

pub async fn password_authorisation(
    State(state): State<AppState>,
    cookies: Cookies,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PasswordAuthorisationReq>,
) -> Result<Json<PwdAuthResponse>, AppError> {
    let user = verify_login(&state.pool, &payload.email, &payload.password).await?;
    let user_uuid = Uuid::from_bytes(user.id.into_bytes());
    let client_meta = model::session::get_client_meta(&headers);
    let session = model::session::UserSession::new(&state.pool, user_uuid, client_meta).await?;
    let session_cookie = build_session_token(state.config.clone(), session.token);
    cookies.add(session_cookie);
    let refresh_cookie = build_refresh_token(state.config.clone(), session.refresh_token);
    cookies.add(refresh_cookie);
    Ok(Json(PwdAuthResponse {
        id: session.id.to_string(),
    }))
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
