// TODO: This will initially handle session based authentication
// via both a bearer token and cookie
use crate::{AppState, model};
use axum::{
    extract::Request, extract::State, http::StatusCode, middleware::Next, response::Json,
    response::Response,
};
use base64::{Engine as _, engine::general_purpose};
use rand::{TryRngCore, rngs::OsRng};
use serde::Serialize;
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

pub async fn password_authorisation(cookies: Cookies) -> Json<PwdAuthResponse> {
    let session_id = gen_session_id();
    println!("Session ID: {}", session_id); // ~27 characters long
    let cookie = Cookie::build(("session_id", session_id))
        .http_only(true)
        // .secure(true)
        .same_site(tower_cookies::cookie::SameSite::Strict)
        .path("/")
        .max_age(tower_cookies::cookie::time::Duration::hours(24))
        .build();
    cookies.add(cookie);
    Json(PwdAuthResponse::default())
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

#[derive(Serialize)]
pub struct CreateUserResponse {
    success: bool,
}

pub async fn create_user(State(state): State<AppState>) -> Json<CreateUserResponse> {
    let username = "test";
    model::user::create(&state.pool, &username).await.unwrap();
    Json(CreateUserResponse { success: true })
}
