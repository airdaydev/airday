//! Web cookie transport for the device token. CLI uses
//! `Authorization: Bearer <token>`; the browser receives a
//! `Set-Cookie: airday_device=...` on every endpoint that mints a token
//! and the same name on `Cookie:` for subsequent requests. See
//! `spec/auth.md`.

use axum::http::{HeaderMap, HeaderValue, header};

pub const COOKIE_NAME: &str = "airday_device";

/// `Set-Cookie` value for a freshly-issued token. `Path=/` so the cookie
/// applies to /api/* and the WS upgrade. `secure` controls the `Secure`
/// attribute — Chromium/Firefox treat `http://localhost` as a secure
/// context so it can stay on, but Safari/WebKit does not, so plain-HTTP
/// dev needs it disabled via `Config::secure_cookies = false`.
pub fn set_cookie(token: &str, secure: bool) -> HeaderValue {
    let secure_attr = if secure { " Secure;" } else { "" };
    HeaderValue::from_str(&format!(
        "{COOKIE_NAME}={token}; HttpOnly;{secure_attr} SameSite=Strict; Path=/"
    ))
    .expect("device token is hex; cookie value is ASCII-safe")
}

/// `Set-Cookie` value used by logout to clear the cookie.
pub fn clear_cookie(secure: bool) -> HeaderValue {
    let secure_attr = if secure { " Secure;" } else { "" };
    HeaderValue::from_str(&format!(
        "{COOKIE_NAME}=; HttpOnly;{secure_attr} SameSite=Strict; Path=/; Max-Age=0"
    ))
    .expect("static cookie attributes are ASCII-safe")
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
