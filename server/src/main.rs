mod config;
use axum::{Router, routing::get};

#[tokio::main]
async fn main() {
    let cfg = config::AirdayConfig::from_toml("port = 3000\nhost = '0.0.0.0'");
    let host_str = format!("{}:{}", cfg.host, cfg.port);
    println!("Airday server started at {}", host_str);
    let app = Router::new().route("/", get(|| async { "Hello, World!" }));
    let listener = tokio::net::TcpListener::bind(format!("{}", host_str))
        .await
        .unwrap();
    axum::serve(listener, app).await.unwrap();
}
