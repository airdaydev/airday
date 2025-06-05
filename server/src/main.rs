mod auth;
mod config;
mod jmap_core;
mod server;
use axum::{Router, routing::get};

#[tokio::main]
async fn main() {
    let cfg = config::AirdayConfig::from_toml("port = 3000\nhost = '0.0.0.0'");
    let host_str = format!("{}:{}", cfg.host, cfg.port);
    println!("Airday server started at http://{}", host_str);
    let app = Router::new()
        .route("/", get(server::root_handler))
        .route("/session", get(jmap_core::session_handler));
    let listener = tokio::net::TcpListener::bind(format!("{}", host_str))
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap();
}
