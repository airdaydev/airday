//! Operator-only JSON endpoints.

use anyhow::Context;
use axum::Json;
use axum::extract::State;
use axum::http::header::{AUTHORIZATION, WWW_AUTHENTICATE};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct AdminStats {
    accounts: u64,
    devices: u64,
}

#[derive(Debug, Serialize)]
struct AdminErrorBody {
    error: &'static str,
}

pub(super) enum AdminError {
    Unauthorized,
    Internal(anyhow::Error),
}

impl IntoResponse for AdminError {
    fn into_response(self) -> Response {
        match self {
            Self::Unauthorized => {
                let mut response = (
                    StatusCode::UNAUTHORIZED,
                    Json(AdminErrorBody {
                        error: "unauthorized",
                    }),
                )
                    .into_response();
                response.headers_mut().insert(
                    WWW_AUTHENTICATE,
                    HeaderValue::from_static("Bearer realm=\"airday-admin\""),
                );
                response
            }
            Self::Internal(error) => {
                tracing::error!(error = %error, "admin stats query failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(AdminErrorBody { error: "internal" }),
                )
                    .into_response()
            }
        }
    }
}

pub async fn stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AdminStats>, AdminError> {
    let password = bearer_password(&headers).ok_or(AdminError::Unauthorized)?;
    if !state.verify_admin_password(password).await {
        return Err(AdminError::Unauthorized);
    }

    let (accounts, devices) = state
        .db
        .call(|connection| {
            connection.query_row(
                "SELECT (SELECT COUNT(*) FROM accounts), (SELECT COUNT(*) FROM devices)",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
        })
        .await
        .context("admin stats counts")
        .map_err(AdminError::Internal)?;

    Ok(Json(AdminStats {
        accounts: accounts as u64,
        devices: devices as u64,
    }))
}

fn bearer_password(headers: &HeaderMap) -> Option<&[u8]> {
    headers
        .get(AUTHORIZATION)?
        .as_bytes()
        .strip_prefix(b"Bearer ")
        .filter(|password| !password.is_empty())
}
