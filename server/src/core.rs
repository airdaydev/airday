// Session
use axum::response::Json;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct JMAPSession {
    pub test: String,
}

pub async fn session_handler() -> Json<JMAPSession> {
    let session = JMAPSession {
        test: String::from("hello"),
    };
    Json(session)
}
