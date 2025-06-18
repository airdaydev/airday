mod common {
    pub mod config;
    pub mod datetime;
    pub mod error;
    pub mod sql;
}
mod jmap {
    pub mod core;
}
mod model;
mod root;
use axum::Router;
use axum::routing::{get, post};
use bpaf::Bpaf;
use sqlx::SqlitePool;
use std::fs;
use tower_cookies::CookieManagerLayer;

use crate::common::config::AirdayConfig;
#[cfg(test)]
pub mod test_util;

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
    config: AirdayConfig,
}

#[derive(Bpaf, Debug, Clone)]
#[bpaf(options, version)]
struct AirdayOptions {
    /// Path to config file
    #[bpaf(fallback(String::from("config.toml")))]
    config: String,
    /// Override database
    sqlx_host: Option<String>,
}

#[tokio::main]
async fn main() {
    let opts = airday_options().run();
    let raw_cfg = fs::read_to_string(opts.config).unwrap();
    let mut cfg = common::config::AirdayConfig::from_toml(&raw_cfg);
    let host_str = format!("{}:{}", cfg.host, cfg.port);

    if let Some(db) = opts.sqlx_host {
        cfg.sqlx_host = db.clone();
    }

    let pool = common::sql::connect_sqlite(&cfg).await;

    let state = AppState {
        pool,
        config: cfg.clone(),
    };

    println!("Airday server started at http://{}", host_str);
    let public = Router::new()
        .route("/", get(root::root_handler))
        .route(
            "/auth/password",
            post(model::auth::password_authorisation_cookie),
        )
        .route(
            "/auth/password/bearer",
            post(model::auth::password_authorisation_bearer),
        )
        .route("/user", post(model::auth::create_user));
    let private = Router::new()
        .route(
            "/auth/refresh",
            post(model::session::refresh_session_cookie),
        )
        .route(
            "/auth/refresh/bearer",
            post(model::session::refresh_session_bearer),
        )
        .route("/auth/sessions", post(model::session::get_user_sessions))
        .route("/jmap/session", get(jmap::core::session_handler));
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
