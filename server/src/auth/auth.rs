use crate::{
    AppState,
    auth::{
        meta::get_client_meta,
        paseto::to_paseto,
        session::{AuthToken, UserSession},
    },
    common::{config::AirdayConfig, error::AppError, sql::Db},
    user::model::{PublicUser, verify_login},
};
use axum::{extract::State, response::Json};
use serde::Deserialize;
use tower_cookies::{Cookie, Cookies};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct PasswordAuthorisationReq {
    pub email: String,
    pub password: String,
}

pub fn build_session_cookie(
    config: AirdayConfig,
    session: &UserSession,
) -> Result<Cookie<'static>, AppError> {
    let token = AuthToken::new_session_token(session);
    let paseto = to_paseto(&token)?;
    Ok(Cookie::build(("session_token", paseto))
        .http_only(true)
        .secure(config.secure_cookies.clone())
        .same_site(tower_cookies::cookie::SameSite::Strict)
        .path("/")
        .max_age(tower_cookies::cookie::time::Duration::hours(24))
        .build())
}

pub fn build_refresh_cookie(
    config: AirdayConfig,
    session: &UserSession,
) -> Result<Cookie<'static>, AppError> {
    let token = AuthToken::new_refresh_token(session);
    let paseto = to_paseto(&token)?;
    Ok(Cookie::build(("refresh_token", paseto))
        .http_only(true)
        .secure(config.secure_cookies.clone())
        .same_site(tower_cookies::cookie::SameSite::Strict)
        .path("/")
        .max_age(tower_cookies::cookie::time::Duration::days(120))
        .build())
}

pub async fn password_authorisation(
    db: &Db,
    headers: axum::http::HeaderMap,
    payload: PasswordAuthorisationReq,
) -> Result<UserSession, AppError> {
    let user = verify_login(&db, &payload.email, &payload.password).await?;
    let client_meta = get_client_meta(&headers);
    let session = UserSession::new(db, user, client_meta).await?;
    Ok(session)
}

pub async fn password_authorisation_cookie(
    State(state): State<AppState>,
    cookies: Cookies,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PasswordAuthorisationReq>,
) -> Result<Json<UserSession>, AppError> {
    let session = password_authorisation(&state.db, headers, payload).await?;
    let session_cookie = build_session_cookie(state.config.clone(), &session)?;
    cookies.add(session_cookie);
    let refresh_cookie = build_refresh_cookie(state.config.clone(), &session)?;
    cookies.add(refresh_cookie);
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
) -> Result<Json<PublicUser>, AppError> {
    let email = payload.email;
    let password = payload.password;
    let user = state.db.user.create(&email, &password).await?;
    let public_user: PublicUser = user.into();
    Ok(Json(public_user))
}

// TODO: SECURITY! Session not properly validated
pub async fn auth_websocket(
    state: &AppState,
    session_token: &str,
    socket_id: &Uuid,
) -> Result<UserSession, AppError> {
    let user_session = state.db.session.get_by_token(&session_token).await?;
    // TODO: SECURITY! VALIDATE THE SESSION!!
    if let Some(sesh) = user_session {
        let set_conn_user_id: bool = {
            // Mutex scope
            let mut map = state.ws.conn_map.lock().unwrap();
            if let Some(conn) = map.get_mut(&socket_id) {
                conn.user_id = Some(sesh.user_id);
                true
            } else {
                false
            }
        };
        if set_conn_user_id == false {
            // TODO: SPAN!?
            println!("WS: User disconnected while authenticating");
            return Err(AppError::ValidationError(String::from(
                "User disconnected while authenticating",
            )));
        }
        // TODO: Span?
        println!("User {:?} authenticated!", sesh.user_id);
        return Ok(sesh);
    }
    Err(AppError::ValidationError(String::from(
        "Authorisation error",
    )))
}
