//! Web cookie transport for the device token. CLI uses
//! `Authorization: Bearer <token>`; the browser receives a
//! `Set-Cookie: airday_device=...` on every endpoint that mints a token
//! and the same name on `Cookie:` for subsequent requests. See
//! `spec/auth.md`.

use axum::http::{header, HeaderMap, HeaderValue};

pub const COOKIE_NAME: &str = "airday_device";

/// `Set-Cookie` value for a freshly-issued token. `Path=/` so the cookie
/// applies to /api/* and the WS upgrade. `Secure` is a no-op on
/// `localhost` in modern browsers (treated as a secure context) so dev
/// over plain HTTP still works.
pub fn set_cookie(token: &str) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{COOKIE_NAME}={token}; HttpOnly; Secure; SameSite=Strict; Path=/"
    ))
    .expect("device token is hex; cookie value is ASCII-safe")
}

/// `Set-Cookie` value used by logout to clear the cookie.
pub fn clear_cookie() -> HeaderValue {
    HeaderValue::from_static(
        "airday_device=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
    )
}

/// Extract the device token from any `Cookie:` header on the request.
/// Returns `None` when no `airday_device` cookie is present.
pub fn token_from_cookies(headers: &HeaderMap) -> Option<&str> {
    for hv in headers.get_all(header::COOKIE).iter() {
        let Ok(s) = hv.to_str() else { continue };
        for pair in s.split(';') {
            let pair = pair.trim();
            if let Some((name, value)) = pair.split_once('=') {
                if name == COOKIE_NAME {
                    return Some(value);
                }
            }
        }
    }
    None
}
