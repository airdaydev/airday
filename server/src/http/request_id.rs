use axum::extract::Request;
use axum::http::HeaderValue;
use axum::http::header::HeaderName;
use axum::response::Response;
use std::time::Instant;
use tracing::Instrument;
use uuid::Uuid;

pub const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");

#[derive(Clone, Debug)]
pub struct RequestId(pub String);

impl RequestId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub async fn middleware(req: Request, next: axum::middleware::Next) -> Response {
    let request_id = request_id_from_headers(req.headers()).unwrap_or_else(new_request_id);
    let request_id_value =
        HeaderValue::from_str(request_id.as_str()).expect("request ids are valid header values");
    let method = req.method().clone();
    let path = req.uri().path().to_owned();
    let is_healthz = path == "/healthz";

    let mut req = req;
    req.extensions_mut().insert(RequestId(request_id.clone()));

    let span = tracing::info_span!(
        "http.request",
        request_id = %request_id,
        http.request.method = %method,
        url.path = %path,
        http.response.status_code = tracing::field::Empty,
        http.server.duration_ms = tracing::field::Empty,
    );
    let started_at = Instant::now();
    let mut response = next.run(req).instrument(span.clone()).await;
    let status = response.status();
    let elapsed_ms = started_at.elapsed().as_millis() as u64;
    span.record("http.response.status_code", status.as_u16());
    span.record("http.server.duration_ms", elapsed_ms);
    if !is_healthz || !status.is_success() {
        tracing::info!(
            parent: &span,
            http.response.status_code = status.as_u16(),
            http.server.duration_ms = elapsed_ms,
            "http request completed"
        );
    }
    response
        .headers_mut()
        .insert(REQUEST_ID_HEADER, request_id_value);
    response
}

fn request_id_from_headers(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get(&REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn new_request_id() -> String {
    Uuid::now_v7().to_string()
}
