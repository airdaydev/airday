mod auth;
mod config;
mod jmap_core;
mod server;
use axum::{Router, middleware, routing::get};
use tower_cookies::CookieManagerLayer;

#[tokio::main]
async fn main() {
    let cfg = config::AirdayConfig::from_toml("port = 3000\nhost = '0.0.0.0'");
    let host_str = format!("{}:{}", cfg.host, cfg.port);
    println!("Airday server started at http://{}", host_str);
    let public = Router::new()
        .route("/", get(server::root_handler))
        .route("/auth/pw", get(auth::password_authorisation));
    let private = Router::new()
        .route("/session", get(jmap_core::session_handler))
        .layer(middleware::from_fn(auth::auth_middleware));
    let listener = tokio::net::TcpListener::bind(format!("{}", host_str))
        .await
        .unwrap();

    let app = Router::new()
        .merge(private)
        .merge(public)
        .layer(CookieManagerLayer::new());

    axum::serve(listener, app).await.unwrap();
}
