use crate::auth::paseto::{deserialize_token, to_paseto};
use crate::auth::token::AuthToken;
use crate::{
    AppState,
    auth::{meta::get_client_meta, session::UserSession},
    common::{config::AirdayConfig, error::AppError, sql::Db},
    user::model::{PublicUser, verify_login},
};
use axum::extract::{FromRef, FromRequestParts, State};
use axum::http::HeaderMap;
use axum::http::request::Parts;
use axum::response::Json;
use serde::Deserialize;
use tower_cookies::Cookie;
use tower_cookies::Cookies;
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

#[axum::debug_handler]
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

#[derive(serde::Serialize)]
pub struct PasswordAuthorisationBearerRes {
    pub session: UserSession,
    pub session_token: String,
    pub refresh_token: String,
}

pub async fn password_authorisation_bearer(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PasswordAuthorisationReq>,
) -> Result<Json<PasswordAuthorisationBearerRes>, AppError> {
    let session = password_authorisation(&state.db, headers, payload).await?;
    let session_token = AuthToken::new_session_token(&session);
    let session_paseto = to_paseto(&session_token)?;
    let refresh_token = AuthToken::new_refresh_token(&session);
    let refresh_paseto = to_paseto(&refresh_token)?;
    Ok(Json(PasswordAuthorisationBearerRes {
        session,
        session_token: session_paseto,
        refresh_token: refresh_paseto,
    }))
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
    let paseto = deserialize_token(session_token)?; // TODO: Does this always validate?
    let user_session = state.db.session.get_by_id(paseto.session_id()).await?;
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

#[derive(Deserialize)]
pub struct RefreshSessionReq {
    pub id: String,
}

#[derive(serde::Serialize)]
pub struct RefreshSessionBearerRes {
    pub session: UserSession,
    pub session_token: String,
    pub refresh_token: String,
}

pub async fn refresh_session_bearer(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(_): Json<RefreshSessionReq>,
) -> Result<Json<RefreshSessionBearerRes>, AppError> {
    let refresh_token = extract_bearer_token(&headers).ok_or(AppError::AuthorisationError(
        String::from("No refresh token"),
    ))?;
    // TODO: does this accept expired or otherwise bad tokens?
    let token = deserialize_token(&refresh_token)?;
    let session = state
        .db
        .session
        .get_by_id(token.session_id())
        .await?
        .ok_or(AppError::ValidationError(String::from("Session not found")))?;
    let session_token = AuthToken::new_session_token(&session);
    let session_paseto = to_paseto(&session_token)?;
    let refresh_token = AuthToken::new_refresh_token(&session);
    let refresh_paseto = to_paseto(&refresh_token)?;
    Ok(Json(RefreshSessionBearerRes {
        session,
        session_token: session_paseto,
        refresh_token: refresh_paseto,
    }))
}

pub async fn refresh_session_cookie(
    State(state): State<AppState>,
    cookies: Cookies,
    Json(_): Json<RefreshSessionReq>,
) -> Result<Json<UserSession>, AppError> {
    let refresh_token = extract_cookie(&cookies, String::from("refresh_token")).ok_or(
        AppError::AuthorisationError(String::from("No refresh token")),
    )?;
    // TODO: does this accept expired or otherwise bad tokens?
    let token = deserialize_token(&refresh_token)?;
    let session = state
        .db
        .session
        .get_by_id(token.session_id())
        .await?
        .ok_or(AppError::ValidationError(String::from("Session not found")))?;
    let session_cookie = build_session_cookie(state.config.clone(), &session)?;
    cookies.add(session_cookie);
    let refresh_cookie = build_refresh_cookie(state.config.clone(), &session)?;
    cookies.add(refresh_cookie);
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

            let paseto = deserialize_token(&token)?;
            let session = app_state
                .db
                .session
                .get_by_id(paseto.session_id())
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
