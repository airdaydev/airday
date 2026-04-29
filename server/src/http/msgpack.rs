//! MessagePack request extractor + response wrapper.
//!
//! Same role as `axum::Json` but for `application/msgpack`. We don't
//! enforce the Content-Type header on requests — sprint 1 clients are
//! all known and the server is single-protocol.

use axum::body::Bytes;
use axum::extract::{rejection::BytesRejection, FromRequest, Request};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::de::DeserializeOwned;
use serde::Serialize;

pub struct Msgpack<T>(pub T);

impl<T, S> FromRequest<S> for Msgpack<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = MsgpackRejection;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let bytes = Bytes::from_request(req, state)
            .await
            .map_err(MsgpackRejection::Bytes)?;
        let value = rmp_serde::from_slice::<T>(&bytes).map_err(MsgpackRejection::Decode)?;
        Ok(Msgpack(value))
    }
}

impl<T> IntoResponse for Msgpack<T>
where
    T: Serialize,
{
    fn into_response(self) -> Response {
        match rmp_serde::to_vec_named(&self.0) {
            Ok(bytes) => (
                [(header::CONTENT_TYPE, super::MSGPACK_CONTENT_TYPE)],
                bytes,
            )
                .into_response(),
            Err(e) => {
                tracing::error!(error = %e, "msgpack encode failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "msgpack encode failed",
                )
                    .into_response()
            }
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MsgpackRejection {
    #[error("failed to read body: {0}")]
    Bytes(BytesRejection),
    #[error("malformed msgpack body: {0}")]
    Decode(rmp_serde::decode::Error),
}

impl IntoResponse for MsgpackRejection {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, self.to_string()).into_response()
    }
}
