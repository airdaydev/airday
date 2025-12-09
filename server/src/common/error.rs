use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use flatbuffers::InvalidFlatbuffer;
use serde_json::json;
use tracing::{Span, error, warn};
use tracing_opentelemetry::OpenTelemetrySpanExt;

#[derive(Debug)]
pub enum AppError {
    AuthorisationError(String),
    ValidationError(String),
    DatabaseError(String),
    ServerError(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let current_span = Span::current();
        let (status, error_message) = match self {
            AppError::AuthorisationError(msg) => {
                warn!(error_type = "AuthorisationError", msg);
                (StatusCode::UNAUTHORIZED, msg)
            }
            AppError::ValidationError(msg) => {
                warn!(error_type = "ValidationError", msg);
                (StatusCode::BAD_REQUEST, msg)
            }
            AppError::DatabaseError(msg) => {
                current_span.record("error", true);
                error!(error_type = "DatabaseError", msg);
                (StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
            AppError::ServerError(msg) => {
                current_span.record("error", true);
                error!(error_type = "ServerError", msg);
                (StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
        };
        let body = Json(json!({
          "error": error_message,
        }));
        (status, body).into_response()
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        let msg = err.to_string();
        error!(error_type = "JsonParseError", msg);
        AppError::ValidationError(String::from("Error parsing JSON"))
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::DatabaseError(err.to_string())
    }
}

impl From<InvalidFlatbuffer> for AppError {
    fn from(err: InvalidFlatbuffer) -> Self {
        AppError::ValidationError(err.to_string())
    }
}
