use axum::response::Json;
use opentelemetry::KeyValue;
use serde::Serialize;
use tracing::Span;
use tracing_opentelemetry::OpenTelemetrySpanExt;

#[derive(Serialize)]
pub struct APIRoot {
    pub version: &'static str,
}

const API_ROOT: APIRoot = APIRoot {
    version: "airday-alpha-0",
};

pub async fn root_handler() -> Json<APIRoot> {
    let cur_span = Span::current();
    cur_span.add_event("wtf", vec![KeyValue::new("hi", "hi")]);
    Json(API_ROOT)
}
