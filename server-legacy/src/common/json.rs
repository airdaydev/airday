use axum::{
    extract::{FromRequest, Request, rejection::JsonRejection},
    response::{IntoResponse, Response},
};
use serde::de::DeserializeOwned;

use crate::common::error::AppError;

/// Custom JSON extractor that returns JSON-formatted errors
pub struct JsonBody<T>(pub T);

impl<S, T> FromRequest<S> for JsonBody<T>
where
    axum::Json<T>: FromRequest<S, Rejection = JsonRejection>,
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        match axum::Json::<T>::from_request(req, state).await {
            Ok(value) => Ok(Self(value.0)),
            Err(rejection) => Err(AppError::ValidationError(rejection.body_text())),
        }
    }
}

impl<T: serde::Serialize> IntoResponse for JsonBody<T> {
    fn into_response(self) -> Response {
        axum::Json(self.0).into_response()
    }
}
