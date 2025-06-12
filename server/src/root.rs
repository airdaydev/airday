use axum::response::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct APIRoot {
    pub version: &'static str,
}

const API_ROOT: APIRoot = APIRoot {
    version: "airday-alpha-0",
};

pub async fn root_handler() -> Json<APIRoot> {
    Json(API_ROOT)
}
