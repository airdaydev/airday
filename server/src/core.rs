// Session
use axum::response::Json;
use serde::Serialize;

/// Session Resource
/// https://datatracker.ietf.org/doc/html/rfc8620#section-2
#[derive(Serialize)]
pub struct JMAPSession {
    pub capabilities: AirdayCapabilities,
}

#[derive(Serialize)]
pub struct AirdayCapabilities {
    #[serde(rename(serialize = "urn:ietf:params:jmap:core"))]
    pub core: CoreCapabilities,
    pub accounts: String,
    // TODO: Contacts
    // TODO: Calendar
    // TODO: Tasks? (Maybe)
}

#[derive(Serialize)]
pub struct CoreCapabilities {
    #[serde(rename(serialize = "maxSizeUpload"))]
    max_size_upload: u64,
    #[serde(rename(serialize = "maxConcurrentUpload"))]
    max_concurrent_upload: usize,
    #[serde(rename(serialize = "maxSizeRequest"))]
    max_size_request: u64,
    #[serde(rename(serialize = "maxConcurrentRequests"))]
    max_concurrent_requests: usize,
    #[serde(rename(serialize = "maxCallsInRequest"))]
    max_calls_in_request: usize,
    #[serde(rename(serialize = "maxCallsInRequest"))]
    max_objects_in_get: usize,
    #[serde(rename(serialize = "maxObjectsInSet"))]
    max_objects_in_set: usize,
    #[serde(rename(serialize = "collationAlgorithms"))]
    collation_algorithms: Vec<String>,
}

pub async fn session_handler() -> Json<JMAPSession> {
    let session = JMAPSession {
        capabilities: AirdayCapabilities {
            core: CoreCapabilities {
                max_size_upload: 50_000_000,
                max_concurrent_upload: 4,
                max_size_request: 10_000,
                max_concurrent_requests: 4,
                max_calls_in_request: 16,
                max_objects_in_get: 500,
                max_objects_in_set: 500,
                collation_algorithms: vec![],
            },
            accounts: String::from("TBC"),
        },
    };
    Json(session)
}
