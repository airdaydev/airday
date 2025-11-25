use crate::auth::session::{AuthToken, UserSession};
use crate::common::config::AirdayConfig;
use crate::common::error::AppError;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use chrono::{DateTime, Utc};
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

/// Serialize a UserSession into a signed PASETO token
pub fn to_paseto(token: &AuthToken) -> Result<String, AppError> {
    let keys = PasetoKeys::get()?;
    let mut claims = Claims::new().map_err(|e| AppError::ServerError(format!("{}", e)))?;
    claims
        .add_additional("session_id", token.session_id().to_string())
        .map_err(|e| AppError::ServerError(format!("{}", e)))?;
    // claims.add_additional("expires", token.exp().to_rfc3339())?;
    claims
        .add_additional("kind", token.kind_str())
        .map_err(|e| AppError::ServerError(format!("{}", e)))?;
    claims
        .add_additional("user_id", token.user_id().to_string())
        .map_err(|e| AppError::ServerError(format!("{}", e)))?;
    let paseto_token = public::sign(&keys.secret, &claims, None, None)
        .map_err(|e| AppError::ServerError(format!("{}", e)))?;
    Ok(paseto_token)
}

/// Deserialize a PASETO token back into a UserSession
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

    // Extract all fields
    let id = extract_uuid(&claims, "id")?;
    let expires = extract_datetime(&claims, "expires")?;
    let user_id = extract_uuid(&claims, "user_id")?;
    // TODO: Refresh or Session?

    Ok(UserSession {
        id,
        token,
        expires,
        refresh_token,
        refresh_expires,
        user_id,
    })
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

fn extract_datetime(claims: &Claims, key: &str) -> Result<DateTime<Utc>, AppError> {
    let datetime_str = extract_string(claims, key)?;
    DateTime::parse_from_rfc3339(&datetime_str)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| AppError::AuthorisationError(format!("Invalid {} datetime", key)))
}
