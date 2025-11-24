use crate::auth::session::UserSession;
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
    fn from_env() -> Result<Self, AppError> {
        let secret_b64 = std::env::var("PASETO_SECRET_KEY").map_err(|_| {
            AppError::ServerError(String::from(
                "PASETO_SECRET_KEY environment variable not set",
            ))
        })?;
        let public_b64 = std::env::var("PASETO_PUBLIC_KEY").map_err(|_| {
            AppError::ServerError(String::from(
                "PASETO_PUBLIC_KEY environment variable not set",
            ))
        })?;

        let secret_bytes = BASE64.decode(&secret_b64).map_err(|e| {
            AppError::ServerError(format!("Failed to decode PASETO_SECRET_KEY: {}", e))
        })?;
        let public_bytes = BASE64.decode(&public_b64).map_err(|e| {
            AppError::ServerError(format!("Failed to decode PASETO_PUBLIC_KEY: {}", e))
        })?;

        let secret = AsymmetricSecretKey::<V4>::from(&secret_bytes)
            .map_err(|e| AppError::ServerError(format!("Failed to parse secret key: {}", e)))?;
        let public = AsymmetricPublicKey::<V4>::from(&public_bytes)
            .map_err(|e| AppError::ServerError(format!("Failed to parse public key: {}", e)))?;

        Ok(Self { secret, public })
    }

    pub fn get() -> Result<&'static PasetoKeys, AppError> {
        PASETO_KEYS.get_or_try_init(|| Self::from_env())
    }
}

/// Serialize a UserSession into a signed PASETO token
pub fn serialize_session(session: &UserSession) -> Result<String, AppError> {
    let keys = PasetoKeys::get()?;
    let mut claims = Claims::new()?;

    // Add all UserSession fields as claims
    claims.add_additional("id", session.id.to_string())?;
    claims.add_additional("token", &session.token)?;
    claims.add_additional("expires", session.expires.to_rfc3339())?;
    claims.add_additional("refresh_token", &session.refresh_token)?;
    claims.add_additional("refresh_expires", session.refresh_expires.to_rfc3339())?;
    claims.add_additional("user_id", session.user_id.to_string())?;

    let paseto_token = public::sign(&keys.secret, &claims, None, None)?;
    Ok(paseto_token)
}

/// Deserialize a PASETO token back into a UserSession
pub fn deserialize_session(token: &str) -> Result<UserSession, AppError> {
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
    let token = extract_string(&claims, "token")?;
    let expires = extract_datetime(&claims, "expires")?;
    let refresh_token = extract_string(&claims, "refresh_token")?;
    let refresh_expires = extract_datetime(&claims, "refresh_expires")?;
    let user_id = extract_uuid(&claims, "user_id")?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn test_serialize_deserialize_session() {
        // Create a mock UserSession
        let session = UserSession {
            id: Uuid::new_v4(),
            token: "test_token_123".to_string(),
            expires: Utc::now() + chrono::Duration::hours(24),
            refresh_token: "test_refresh_token_456".to_string(),
            refresh_expires: Utc::now() + chrono::Duration::days(30),
            user_id: Uuid::new_v4(),
        };

        // Serialize to PASETO
        let paseto_token = serialize_session(&session).expect("Failed to serialize session");

        // Verify it's a PASETO token (v4.public prefix)
        assert!(paseto_token.starts_with("v4.public."));

        // Deserialize back
        let deserialized = deserialize_session(&paseto_token).expect("Failed to deserialize session");

        // Verify all fields match
        assert_eq!(session.id, deserialized.id);
        assert_eq!(session.token, deserialized.token);
        assert_eq!(session.refresh_token, deserialized.refresh_token);
        assert_eq!(session.user_id, deserialized.user_id);

        // DateTime comparison (allowing small precision differences)
        let expires_diff = (session.expires.timestamp() - deserialized.expires.timestamp()).abs();
        assert!(expires_diff < 2, "Expires timestamps should be nearly equal");

        let refresh_expires_diff = (session.refresh_expires.timestamp() - deserialized.refresh_expires.timestamp()).abs();
        assert!(refresh_expires_diff < 2, "Refresh expires timestamps should be nearly equal");
    }

    #[test]
    fn test_invalid_token_fails() {
        let result = deserialize_session("invalid_token");
        assert!(result.is_err());
    }

    #[test]
    fn test_tampered_token_fails() {
        // Create and serialize a session
        let session = UserSession {
            id: Uuid::new_v4(),
            token: "test_token".to_string(),
            expires: Utc::now() + chrono::Duration::hours(24),
            refresh_token: "test_refresh".to_string(),
            refresh_expires: Utc::now() + chrono::Duration::days(30),
            user_id: Uuid::new_v4(),
        };

        let paseto_token = serialize_session(&session).expect("Failed to serialize");

        // Tamper with the token
        let mut tampered = paseto_token;
        tampered.push('x');

        // Should fail verification
        let result = deserialize_session(&tampered);
        assert!(result.is_err());
    }
}
