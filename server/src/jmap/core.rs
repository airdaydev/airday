// Session
use axum::response::Json;
use serde::Serialize;

use crate::model::session::UserSession;

/// Session Resource
/// https://datatracker.ietf.org/doc/html/rfc8620#section-2
#[derive(Serialize)]
pub struct JMAPSession {
    pub capabilities: AirdayCapabilities,
    pub accounts: Account,
    #[serde(rename(serialize = "primaryAccounts"))]
    primary_accounts: String,
    username: String,
    #[serde(rename(serialize = "apiUrl"))]
    api_url: String,
    #[serde(rename(serialize = "downloadUrl"))]
    download_url: String,
    #[serde(rename(serialize = "uploadUrl"))]
    upload_url: String,
    #[serde(rename(serialize = "eventSourceUrl"))]
    event_source_url: String,
    state: String,
}

#[derive(Serialize)]
pub struct AirdayCapabilities {
    #[serde(rename(serialize = "urn:ietf:params:jmap:core"))]
    pub core: CoreCapabilities,
    #[serde(rename(serialize = "urn:ietf:params:jmap:contacts"))]
    pub contacts: String,
    #[serde(rename(serialize = "urn:ietf:params:jmap:calendar"))]
    pub calendar: String,
    // TODO: Tasks? (Maybe)
}

#[derive(Serialize)]
pub struct Account {
    name: String, // e.g. email
    #[serde(rename(serialize = "isPersonal"))]
    is_personal: bool,
    #[serde(rename(serialize = "isReadOnly"))]
    is_read_only: bool,
    #[serde(rename(serialize = "accountCapabilities"))]
    account_capabilities: String,
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

pub async fn session_handler(session: UserSession) -> Json<JMAPSession> {
    let jmap_session = JMAPSession {
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
            contacts: String::from("tbc"),
            calendar: String::from("tbc"),
        },
        accounts: Account {
            name: String::from("daniel@air.day"),
            is_personal: true,
            is_read_only: true,
            account_capabilities: String::from("tbc"),
        },
        primary_accounts: String::from("tbc"),
        username: String::from("daniel@air.day"),
        api_url: String::from("localhost"),
        download_url: String::from("localhost"),
        upload_url: String::from("localhost"),
        event_source_url: String::from("localhost"),
        state: String::from("000"),
    };
    Json(jmap_session)
}
