//! Account / password / recovery HTTP handlers.

use airday_protocol::{
    DeviceCredential, LoginRequest, LoginResponse, PasswordChangeRequest, PasswordResetRequest,
    PasswordResetResponse, PreloginRequest, PreloginResponse, RecoverRequest, RecoverResponse,
    SignupRequest, SignupResponse,
};
use anyhow::Context;
use axum::extract::State;
use axum::http::{header, HeaderMap};

use crate::auth::cookie;
use crate::auth::queries::{
    self, create_account, create_device, create_recovery_session, find_account_by_email,
    find_account_by_id, revoke_device, update_password, NewAccount, PasswordUpdate,
};
use crate::auth::tokens::{encode_token, generate_token, sha256};
use crate::auth::DeviceAuth;
use crate::error::{ApiError, ApiResult};
use crate::http::msgpack::Msgpack;
use crate::state::AppState;

/// 15 minutes per `spec/auth.md`.
const RECOVERY_SESSION_TTL_MILLIS: i64 = 15 * 60 * 1000;

pub async fn signup(
    State(state): State<AppState>,
    Msgpack(req): Msgpack<SignupRequest>,
) -> ApiResult<(HeaderMap, Msgpack<SignupResponse>)> {
    if req.email.trim().is_empty() {
        return Err(ApiError::BadRequest("email is required".into()));
    }
    if req.device_name.trim().is_empty() {
        return Err(ApiError::BadRequest("device_name is required".into()));
    }
    let device_token = generate_token();
    let device_token_hash = sha256(&device_token).to_vec();
    let recovery = req.recovery.as_ref();
    let new = NewAccount {
        email: req.email,
        password_hash: sha256(&req.auth_secret).to_vec(),
        password_salt: req.master_salt,
        kdf_params: req.kdf_params,
        wrapped_dek: req.wrapped_dek,
        wrapped_dek_nonce: req.wrapped_dek_nonce,
        recovery_salt: recovery.map(|r| r.recovery_salt.clone()),
        recovery_auth_hash: recovery.map(|r| sha256(&r.recovery_auth_secret).to_vec()),
        recovery_wrapped_dek: recovery.map(|r| r.recovery_wrapped_dek.clone()),
        recovery_wrapped_dek_nonce: recovery.map(|r| r.recovery_wrapped_dek_nonce.clone()),
        device_name: req.device_name,
        device_token_hash,
    };
    let created = create_account(&state.db, new).await.map_err(|e| {
        if e.to_string() == "account_exists" {
            ApiError::AccountExists
        } else {
            ApiError::Internal(e)
        }
    })?;
    let token_hex = encode_token(&device_token);
    Ok((
        cookie_headers(cookie::set_cookie(&token_hex, state.secure_cookies)),
        Msgpack(SignupResponse {
            account_id: created.account_id.to_string(),
            device_id: created.device_id.to_string(),
            device_token: token_hex,
        }),
    ))
}

pub async fn prelogin(
    State(state): State<AppState>,
    Msgpack(req): Msgpack<PreloginRequest>,
) -> ApiResult<Msgpack<PreloginResponse>> {
    let account = find_account_by_email(&state.db, req.email)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Msgpack(PreloginResponse {
        master_salt: account.password_salt,
        kdf_params: account.kdf_params,
        recovery_salt: account.recovery_salt,
    }))
}

pub async fn login(
    State(state): State<AppState>,
    Msgpack(req): Msgpack<LoginRequest>,
) -> ApiResult<(HeaderMap, Msgpack<LoginResponse>)> {
    let account = find_account_by_email(&state.db, req.email)
        .await?
        .ok_or(ApiError::InvalidCredentials)?;
    let presented = sha256(&req.auth_secret);
    if !constant_time_eq(presented.as_slice(), &account.password_hash) {
        return Err(ApiError::InvalidCredentials);
    }
    let device = if let Some(reg) = req.register_device {
        if reg.name.trim().is_empty() {
            return Err(ApiError::BadRequest("device.name is required".into()));
        }
        let token = generate_token();
        let device_id =
            create_device(&state.db, account.id, reg.name, sha256(&token).to_vec()).await?;
        Some(DeviceCredential {
            device_id: device_id.to_string(),
            device_token: encode_token(&token),
        })
    } else {
        None
    };
    let recovery_present = account.recovery_present();
    // Cookie only when this call also registered a device for the
    // caller — otherwise no token was minted for them and there's
    // nothing to set.
    let headers = match device.as_ref() {
        Some(cred) => cookie_headers(cookie::set_cookie(&cred.device_token, state.secure_cookies)),
        None => HeaderMap::new(),
    };
    Ok((
        headers,
        Msgpack(LoginResponse {
            account_id: account.id.to_string(),
            wrapped_dek: account.wrapped_dek,
            wrapped_dek_nonce: account.wrapped_dek_nonce,
            recovery_present,
            device,
        }),
    ))
}

pub async fn recover(
    State(state): State<AppState>,
    Msgpack(req): Msgpack<RecoverRequest>,
) -> ApiResult<Msgpack<RecoverResponse>> {
    let account = find_account_by_email(&state.db, req.email)
        .await?
        .ok_or(ApiError::InvalidCredentials)?;
    // Only accounts that opted into a recovery code can use this path.
    let (Some(recovery_auth_hash), Some(recovery_wrapped_dek), Some(recovery_wrapped_dek_nonce)) = (
        account.recovery_auth_hash.as_deref(),
        account.recovery_wrapped_dek.clone(),
        account.recovery_wrapped_dek_nonce.clone(),
    ) else {
        return Err(ApiError::RecoveryNotEnrolled);
    };
    let presented = sha256(&req.recovery_auth_secret);
    if !constant_time_eq(presented.as_slice(), recovery_auth_hash) {
        return Err(ApiError::InvalidCredentials);
    }
    let session_token = generate_token();
    create_recovery_session(
        &state.db,
        account.id,
        sha256(&session_token).to_vec(),
        RECOVERY_SESSION_TTL_MILLIS,
    )
    .await?;
    Ok(Msgpack(RecoverResponse {
        account_id: account.id.to_string(),
        recovery_wrapped_dek,
        recovery_wrapped_dek_nonce,
        recovery_session_token: encode_token(&session_token),
    }))
}

pub async fn password_change(
    State(state): State<AppState>,
    auth: DeviceAuth,
    Msgpack(req): Msgpack<PasswordChangeRequest>,
) -> ApiResult<()> {
    let account = find_account_by_id(&state.db, auth.account_id)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let presented = sha256(&req.current_auth_secret);
    if !constant_time_eq(presented.as_slice(), &account.password_hash) {
        return Err(ApiError::InvalidCredentials);
    }
    update_password(
        &state.db,
        PasswordUpdate {
            account_id: account.id,
            new_password_hash: sha256(&req.new_auth_secret).to_vec(),
            new_password_salt: req.new_master_salt,
            new_kdf_params: req.new_kdf_params,
            new_wrapped_dek: req.new_wrapped_dek,
            new_wrapped_dek_nonce: req.new_wrapped_dek_nonce,
        },
    )
    .await?;
    Ok(())
}

pub async fn password_reset(
    State(state): State<AppState>,
    Msgpack(req): Msgpack<PasswordResetRequest>,
) -> ApiResult<(HeaderMap, Msgpack<PasswordResetResponse>)> {
    if req.device_name.trim().is_empty() {
        return Err(ApiError::BadRequest("device_name is required".into()));
    }
    let token = crate::auth::tokens::decode_token(&req.recovery_session_token)
        .ok_or(ApiError::RecoverySessionInvalid)?;
    let consumed = queries::consume_recovery_session(&state.db, sha256(&token).to_vec())
        .await?
        .ok_or(ApiError::RecoverySessionInvalid)?;

    update_password(
        &state.db,
        PasswordUpdate {
            account_id: consumed.account_id,
            new_password_hash: sha256(&req.new_auth_secret).to_vec(),
            new_password_salt: req.new_master_salt,
            new_kdf_params: req.new_kdf_params,
            new_wrapped_dek: req.new_wrapped_dek,
            new_wrapped_dek_nonce: req.new_wrapped_dek_nonce,
        },
    )
    .await?;

    let device_token = generate_token();
    let device_id = create_device(
        &state.db,
        consumed.account_id,
        req.device_name,
        sha256(&device_token).to_vec(),
    )
    .await?;

    let token_hex = encode_token(&device_token);
    Ok((
        cookie_headers(cookie::set_cookie(&token_hex, state.secure_cookies)),
        Msgpack(PasswordResetResponse {
            device_id: device_id.to_string(),
            device_token: token_hex,
        }),
    ))
}

#[tracing::instrument(
    skip(state),
    fields(account_id = %auth.account_id, device_id = %auth.device_id)
)]
pub async fn logout(State(state): State<AppState>, auth: DeviceAuth) -> ApiResult<(HeaderMap, ())> {
    // `revoke_device` is idempotent — a stale cookie pointing at an
    // already-revoked device won't 404 us into a useless error here.
    let _ = revoke_device(&state.db, auth.account_id, auth.device_id)
        .await
        .context("auth.logout revoke_device")?;
    Ok((
        cookie_headers(cookie::clear_cookie(state.secure_cookies)),
        (),
    ))
}

fn cookie_headers(value: axum::http::HeaderValue) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(header::SET_COOKIE, value);
    headers
}

/// Constant-time byte slice equality. For password / token comparisons.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
