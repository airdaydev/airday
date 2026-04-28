use crate::{auth::session::UserSession, common::error::AppError};
use std::time::Duration;
use uuid::Uuid;

pub enum AuthTokenKind {
    SESSION,
    REFRESH,
}

pub const SESSION_CONST: &'static str = "session";
pub const REFRESH_CONST: &'static str = "refresh";

pub fn match_token_kind(str: &str) -> Result<AuthTokenKind, AppError> {
    if str == SESSION_CONST {
        return Ok(AuthTokenKind::SESSION);
    }
    if str == REFRESH_CONST {
        return Ok(AuthTokenKind::REFRESH);
    }
    Err(AppError::ValidationError(String::from(
        "Invalid token kind",
    )))
}

#[derive(Clone, Debug)]
pub struct TokenData {
    pub session_id: Uuid,
    pub user_id: Uuid,
    pub primary_library_id: Uuid,
}

#[derive(Clone, Debug)]
pub enum AuthToken {
    SessionToken(TokenData),
    RefreshToken(TokenData),
}

impl AuthToken {
    pub fn new_session_token(session: &UserSession) -> Self {
        AuthToken::SessionToken(TokenData {
            session_id: session.id,
            user_id: session.user_id,
            primary_library_id: session.primary_library,
        })
    }

    pub fn new_refresh_token(session: &UserSession) -> Self {
        AuthToken::RefreshToken(TokenData {
            session_id: session.id,
            user_id: session.user_id,
            primary_library_id: session.primary_library,
        })
    }

    pub fn data(&self) -> &TokenData {
        match self {
            AuthToken::SessionToken(data) => data,
            AuthToken::RefreshToken(data) => data,
        }
    }

    pub fn kind_str(&self) -> &'static str {
        match self {
            AuthToken::SessionToken(_) => SESSION_CONST,
            AuthToken::RefreshToken(_) => REFRESH_CONST,
        }
    }

    pub fn session_id(&self) -> Uuid {
        self.data().session_id
    }

    pub fn primary_library_id(&self) -> Uuid {
        self.data().primary_library_id
    }

    pub fn user_id(&self) -> Uuid {
        self.data().user_id
    }

    pub fn expires_in(&self) -> Duration {
        match self {
            AuthToken::SessionToken(_) => Duration::from_secs(24 * 60 * 60), // 24 hours
            AuthToken::RefreshToken(_) => Duration::from_secs(30 * 24 * 60 * 60), // 30 days
        }
    }
}
