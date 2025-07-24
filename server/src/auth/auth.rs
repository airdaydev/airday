use crate::{
    AppState,
    auth::session::{UserSession, get_client_meta},
    common::{config::AirdayConfig, error::AppError, sql::Db},
    user::model::{User, verify_login},
    workspace::model::Workspace,
};
use axum::{extract::State, response::Json};
use serde::{Deserialize, Serialize};
use tower_cookies::{Cookie, Cookies};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct PasswordAuthorisationReq {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub session: UserSession,
    pub workspace_id: String,
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
    let client_meta = get_client_meta(&headers);
    let session = UserSession::new(db, user_uuid, client_meta).await?;
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
    //         // TODO: Improve with default workspace
    // let user = state
    //     .db
    //     .user
    //     .get_by_id(&session.user_id)
    //     .await?
    //     .ok_or(AppError::ServerError(String::from("User retrieval failed")))?;
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

pub async fn create_user(
    State(state): State<AppState>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<Json<User>, AppError> {
    let email = payload.email;
    let password = payload.password;
    let user = state.db.user.create(&email, &password).await?;
    Ok(Json(user))
}
