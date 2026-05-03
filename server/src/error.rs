use airday_protocol::ErrorBody;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::http::msgpack::Msgpack;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("malformed request: {0}")]
    BadRequest(String),

    #[error("invalid credentials")]
    InvalidCredentials,

    #[error("account exists")]
    AccountExists,

    #[error("not found")]
    NotFound,

    #[error("recovery not enrolled")]
    RecoveryNotEnrolled,

    #[error("recovery session invalid or expired")]
    RecoverySessionInvalid,

    #[error("missing or invalid bearer token")]
    Unauthorized,

    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl ApiError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        use ApiError::*;
        match self {
            BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            InvalidCredentials => (StatusCode::UNAUTHORIZED, "invalid_credentials"),
            AccountExists => (StatusCode::CONFLICT, "account_exists"),
            NotFound => (StatusCode::NOT_FOUND, "not_found"),
            RecoveryNotEnrolled => (StatusCode::FORBIDDEN, "recovery_not_enrolled"),
            RecoverySessionInvalid => (StatusCode::FORBIDDEN, "recovery_session_invalid"),
            Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();
        if let ApiError::Internal(err) = &self {
            tracing::error!(error = ?err, "internal error");
        }
        let body = ErrorBody {
            code: code.to_string(),
            message: self.to_string(),
        };
        (status, Msgpack(body)).into_response()
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        ApiError::Internal(anyhow::Error::new(e))
    }
}

impl From<tokio_rusqlite::Error> for ApiError {
    fn from(e: tokio_rusqlite::Error) -> Self {
        ApiError::Internal(anyhow::Error::new(e))
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
