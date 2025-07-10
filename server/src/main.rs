mod common {
    pub mod config;
    pub mod datetime;
    pub mod error;
    pub mod sql;
}
mod sync {
    pub mod airday;
    pub mod outgoing;
    #[allow(unsafe_op_in_unsafe_fn, unused_imports, dead_code)]
    pub mod proto_generated;
    pub mod websocket;
}
mod jmap {
    pub mod core;
}
mod model;
mod root;
use crate::common::config::AirdayConfig;
use crate::common::sql::Db;
use axum::Router;
use axum::routing::{any, get, post};
use bpaf::Bpaf;
use std::fs;
use tower_cookies::CookieManagerLayer;
#[cfg(test)]
pub mod test_util;

#[derive(Clone)]
struct AppState {
    db: Db,
    config: AirdayConfig,
    ws_connection_map: sync::websocket::WSConnectionMap,
    // ws_sub_map: sync::websocket::WSSubMap,
}

#[derive(Bpaf, Debug, Clone)]
#[bpaf(options, version)]
struct AirdayOptions {
    /// Path to config file
    #[bpaf(fallback(String::from("config.toml")))]
    config: String,
    /// Override database
    sqlx_host: Option<String>,
    port: Option<usize>,
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

    if let Some(port) = opts.port {
        cfg.port = port;
    }

    // TODO: Match config to make correct connection (pg vs sql)
    let db = common::sql::connect_sqlite(&cfg).await;

    let state = AppState {
        db: db,
        config: cfg.clone(),
        // ws_sub_map: sync::websocket::build_ws_sub_map(),
        ws_connection_map: sync::websocket::build_ws_conn_map(),
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
        .route("/jmap/session", get(jmap::core::session_handler))
        .route("/ws", any(sync::websocket::handler));

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
