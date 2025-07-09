use crate::{
    AppState,
    common::{config::AirdayConfig, error::AppError, sql::Db},
    model::{self, session::UserSession, user::verify_login, workspace::Workspace},
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

pub fn build_session_cookie(config: AirdayConfig, token: &str) -> Cookie<'static> {
    Cookie::build(("session_token", String::from(token)))
        .http_only(true)
        .secure(config.secure_cookies.clone())
        .same_site(tower_cookies::cookie::SameSite::Strict)
        .path("/")
        .max_age(tower_cookies::cookie::time::Duration::hours(24))
        .build()
}

pub fn build_refresh_cookie(config: AirdayConfig, token: &str) -> Cookie<'static> {
    Cookie::build(("refresh_token", String::from(token)))
        .http_only(true)
        .secure(config.secure_cookies.clone())
        .same_site(tower_cookies::cookie::SameSite::Strict)
        .path("/")
        .max_age(tower_cookies::cookie::time::Duration::days(120))
        .build()
}

pub async fn password_authorisation(
    db: &Db,
    headers: axum::http::HeaderMap,
    payload: PasswordAuthorisationReq,
) -> Result<UserSession, AppError> {
    let user = verify_login(&db, &payload.email, &payload.password).await?;
    let user_uuid = Uuid::from_bytes(user.id.into_bytes());
    let client_meta = model::session::get_client_meta(&headers);
    let session = model::session::UserSession::new(db, user_uuid, client_meta).await?;
    Ok(session)
}

pub async fn password_authorisation_cookie(
    State(state): State<AppState>,
    cookies: Cookies,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PasswordAuthorisationReq>,
) -> Result<Json<UserSession>, AppError> {
    let session = password_authorisation(&state.db, headers, payload).await?;
    let session_cookie = build_session_cookie(state.config.clone(), &session.token);
    cookies.add(session_cookie);
    let refresh_cookie = build_refresh_cookie(state.config.clone(), &session.refresh_token);
    cookies.add(refresh_cookie);
    // TODO: Remove tokens from cookie sessions
    Ok(Json(session))
}

pub async fn password_authorisation_bearer(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PasswordAuthorisationReq>,
) -> Result<Json<UserSession>, AppError> {
    let session = password_authorisation(&state.db, headers, payload).await?;
    Ok(Json(session))
}

#[derive(Deserialize)]
pub struct CreateUserRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct CreateUserResponse {
    id: String,
    default_workspace: Workspace,
}

pub async fn create_user(
    State(state): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<Json<CreateUserResponse>, AppError> {
    let email = payload.email;
    let password = payload.password;
    // TODO: Fallback mechanism/ux if workspace not created.
    // Or consider putting these in a transaction.
    let user = state.db.user.create(&email, &password).await?;
    let workspace = state.db.workspaces.create(&user.id).await?;
    Ok(Json(CreateUserResponse {
        id: user.id.to_string(),
        default_workspace: workspace,
    }))
}
