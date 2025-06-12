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
use tower_cookies::{Cookie, Cookies};

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

pub async fn password_authorisation(
    State(state): State<AppState>,
    cookies: Cookies,
    Json(payload): Json<PasswordAuthorisationReq>,
) -> Result<Json<PwdAuthResponse>, AppError> {
    verify_login(&state.pool, &payload.email, &payload.password).await?;
    let session_id = gen_session_id();
    let cookie = Cookie::build(("session_id", session_id))
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
    cookies: Cookies,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if let Some(session_cookie) = cookies.get("session_id") {
        // TODO: Check session validity
        println!("{}", session_cookie);
        Ok(next.run(request).await)
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
