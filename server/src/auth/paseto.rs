use crate::auth::token::{AuthToken, AuthTokenKind, TokenData, match_token_kind};
use crate::common::config::AirdayConfig;
use crate::common::error::AppError;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use core::convert::TryFrom;
use pasetors::claims::{Claims, ClaimsValidationRules};
use pasetors::keys::{AsymmetricPublicKey, AsymmetricSecretKey};
use pasetors::token::UntrustedToken;
use pasetors::{Public, public, version4::V4};
use std::sync::OnceLock;
use uuid::Uuid;

static PASETO_KEYS: OnceLock<PasetoKeys> = OnceLock::new();

pub struct PasetoKeys {
    pub secret: AsymmetricSecretKey<V4>,
    pub public: AsymmetricPublicKey<V4>,
}

impl PasetoKeys {
    fn get() -> Result<&'static PasetoKeys, AppError> {
        PASETO_KEYS.get().ok_or(AppError::ServerError(format!(
            "Error retrieving PASETO keys"
        )))
    }
    pub fn set_keys(cfg: &AirdayConfig) -> Result<(), AppError> {
        let public_raw = BASE64
            .decode(&cfg.paseto_pk_b64)
            .map_err(|e| AppError::ServerError(format!("Error decoding paseto_pk_b64: {}", e)))?;
        let public = AsymmetricPublicKey::<V4>::from(&public_raw)
            .map_err(|e| AppError::ServerError(format!("Failed to decode paseto_pk_b64: {}", e)))?;
        let secret_raw = BASE64
            .decode(&cfg.paseto_sk_b64)
            .map_err(|e| AppError::ServerError(format!("Error decoding paseto_sk_b64: {}", e)))?;
        let secret = AsymmetricSecretKey::<V4>::from(&secret_raw)
            .map_err(|e| AppError::ServerError(format!("Failed to decode paseto_sk_64: {}", e)))?;
        PASETO_KEYS.set(PasetoKeys { public, secret });
        Ok(())
    }
}

pub fn to_paseto(token: &AuthToken) -> Result<String, AppError> {
    let keys = PasetoKeys::get()?;
    let mut claims = Claims::new().map_err(|e| AppError::ServerError(format!("{}", e)))?;
    claims
        .set_expires_in(&token.expires_in())
        .map_err(|e| AppError::ServerError(format!("Failed to set expiry: {}", e)))?;
    claims
        .add_additional("s_id", token.session_id().to_string())
        .map_err(|e| AppError::ServerError(format!("{}", e)))?;
    claims
        .add_additional("p_id", token.primary_library_id().to_string())
        .map_err(|e| AppError::ServerError(format!("{}", e)))?;
    claims
        .add_additional("k", token.kind_str())
        .map_err(|e| AppError::ServerError(format!("{}", e)))?;
    claims
        .add_additional("u_id", token.user_id().to_string())
        .map_err(|e| AppError::ServerError(format!("{}", e)))?;
    let paseto_token = public::sign(&keys.secret, &claims, None, None)
        .map_err(|e| AppError::ServerError(format!("{}", e)))?;
    Ok(paseto_token)
}

pub fn deserialize_token(token: &str) -> Result<AuthToken, AppError> {
    let keys = PasetoKeys::get()?;

    let validation_rules = ClaimsValidationRules::new();
    let untrusted_token = UntrustedToken::<Public, V4>::try_from(token)
        .map_err(|e| AppError::AuthorisationError(format!("Invalid token format: {}", e)))?;

    let trusted_token = public::verify(
        &keys.public,
        &untrusted_token,
        &validation_rules,
        None,
        None,
    )
    .map_err(|e| AppError::AuthorisationError(format!("Token verification failed: {}", e)))?;

    let claims = trusted_token
        .payload_claims()
        .ok_or(AppError::AuthorisationError(String::from(
            "No claims in token",
        )))?;

    let session_id = extract_uuid(&claims, "s_id")?;
    let user_id = extract_uuid(&claims, "u_id")?;
    let primary_library_id = extract_uuid(&claims, "p_id")?;
    let kind = extract_kind(&claims, "k")?;

    let data = TokenData {
        session_id,
        user_id,
        primary_library_id,
    };

    let token = match kind {
        AuthTokenKind::SESSION => AuthToken::SessionToken(data),
        AuthTokenKind::REFRESH => AuthToken::RefreshToken(data),
    };

    Ok(token)
}

// Helper functions to extract typed values from claims
fn extract_string(claims: &Claims, key: &str) -> Result<String, AppError> {
    claims
        .get_claim(key)
        .ok_or(AppError::AuthorisationError(format!(
            "Missing {} claim",
            key
        )))?
        .as_str()
        .ok_or(AppError::AuthorisationError(format!(
            "Invalid {} format",
            key
        )))
        .map(|s| s.to_string())
}

fn extract_uuid(claims: &Claims, key: &str) -> Result<Uuid, AppError> {
    let uuid_str = extract_string(claims, key)?;
    Uuid::parse_str(&uuid_str)
        .map_err(|_| AppError::AuthorisationError(format!("Invalid {} UUID", key)))
}

fn extract_kind(claims: &Claims, key: &str) -> Result<AuthTokenKind, AppError> {
    let kind_str = extract_string(claims, key)?;
    match_token_kind(&kind_str)
}
