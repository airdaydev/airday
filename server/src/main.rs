mod auth;
mod config;
mod error;
mod jmap_core;
mod model;
mod server;
mod sql;
use axum::routing::{get, post};
use axum::{Router, middleware};
use sqlx::SqlitePool;
use std::fs;
use tower_cookies::CookieManagerLayer;
#[cfg(test)]
pub mod test_util;

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
}

#[tokio::main]
async fn main() {
    let raw_cfg = fs::read_to_string("config.toml").unwrap();
    let cfg = config::AirdayConfig::from_toml(&raw_cfg);
    let host_str = format!("{}:{}", cfg.host, cfg.port);

    let pool = sql::connect_sqlite(&cfg).await;

    let state = AppState { pool };

    println!("Airday server started at http://{}", host_str);
    let public = Router::new()
        .route("/", get(server::root_handler))
        .route("/auth/pw", get(auth::password_authorisation))
        .route("/user", get(auth::create_user));
    let private = Router::new()
        .route("/session", post(jmap_core::session_handler))
        .layer(middleware::from_fn(auth::auth_middleware));
    let listener = tokio::net::TcpListener::bind(format!("{}", host_str))
        .await
        .unwrap();

    let app = Router::new()
        .merge(private)
        .merge(public)
        .with_state(state)
        .layer(CookieManagerLayer::new());

    axum::serve(listener, app).await.unwrap();
}
