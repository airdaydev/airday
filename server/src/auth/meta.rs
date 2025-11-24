#[derive(Clone)]
pub struct ClientMeta {
    pub ip: String,
    pub user_agent: String,
}

pub fn get_client_meta(headers: &axum::http::HeaderMap) -> ClientMeta {
    let user_agent = headers
        .get("user-agent")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("Unknown")
        .to_string();

    let ip = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|h| h.to_str().ok())
        .unwrap_or("Unknown")
        .to_string();
    return ClientMeta { user_agent, ip };
}
