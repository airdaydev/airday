use crate::auth::token::{AuthToken, AuthTokenKind, TokenData, match_token_kind};
use crate::common::config::AirdayConfig;
use crate::common::error::AppError;
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
        let public = AsymmetricPublicKey::<V4>::try_from(cfg.paseto_pk.as_str())
            .map_err(|e| AppError::ServerError(format!("Error parsing paseto_pk: {}", e)))?;
        let secret = AsymmetricSecretKey::<V4>::try_from(cfg.paseto_sk.as_str())
            .map_err(|e| AppError::ServerError(format!("Error parsing paseto_sk: {}", e)))?;
        if let Err(_) = PASETO_KEYS.set(PasetoKeys { public, secret }) {
            return Err(AppError::ServerError(String::from(
                "Paseto keys in PASERK format not loading",
            )));
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{create_test_db, mock_session, mock_user};
    use pasetors::keys::{AsymmetricKeyPair, Generate};
    use pasetors::paserk::FormatAsPaserk;

    fn setup_test_keys() {
        let kp = AsymmetricKeyPair::<V4>::generate().unwrap();
        let mut secret_paserk = String::new();
        kp.secret.fmt(&mut secret_paserk).unwrap();
        let mut public_paserk = String::new();
        kp.public.fmt(&mut public_paserk).unwrap();

        let cfg = AirdayConfig {
            paseto_pk: public_paserk,
            paseto_sk: secret_paserk,
            ..Default::default()
        };
        let _ = PasetoKeys::set_keys(&cfg);
    }

    #[tokio::test]
    async fn test_session_token_roundtrip() {
        setup_test_keys();
        let db = create_test_db().await;
        let user = mock_user(&db, String::from("test_session_roundtrip@air.day")).await;
        let session = mock_session(&db, user).await;

        let token = AuthToken::new_session_token(&session);
        let paseto_str = to_paseto(&token).expect("Failed to serialize to PASETO");
        println!("paseto_str: {}", paseto_str);
        let deserialized = deserialize_token(&paseto_str).expect("Failed to deserialize PASETO");

        assert_eq!(deserialized.session_id(), session.id);
        assert_eq!(deserialized.user_id(), session.user_id);
        assert_eq!(deserialized.primary_library_id(), session.primary_library);
        assert_eq!(deserialized.kind_str(), "session");
    }

    #[tokio::test]
    async fn test_refresh_token_roundtrip() {
        setup_test_keys();
        let db = create_test_db().await;
        let user = mock_user(&db, String::from("test_refresh_roundtrip@air.day")).await;
        let session = mock_session(&db, user).await;

        let token = AuthToken::new_refresh_token(&session);
        let paseto_str = to_paseto(&token).expect("Failed to serialize to PASETO");
        let deserialized = deserialize_token(&paseto_str).expect("Failed to deserialize PASETO");

        assert_eq!(deserialized.session_id(), session.id);
        assert_eq!(deserialized.user_id(), session.user_id);
        assert_eq!(deserialized.primary_library_id(), session.primary_library);
        assert_eq!(deserialized.kind_str(), "refresh");
    }
}
