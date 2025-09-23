mod common {
    pub mod config;
    pub mod datetime;
    pub mod error;
    pub mod sql;
    pub mod utils;
}
mod sync_transport {
    pub mod fb;
    #[allow(unsafe_op_in_unsafe_fn, unused_imports, dead_code)]
    pub mod proto_generated;
    pub mod stream;
    pub mod sync;
    pub mod websocket;
}
mod user {
    pub mod model;
    pub mod sqlite;
}
mod library {
    pub mod model;
    pub mod sqlite;
}
mod telemetry {
    pub mod otlp;
}
mod auth {
    pub mod auth;
    pub mod cache;
    pub mod session;
}
mod sync_engine {
    pub mod engine;
    pub mod sqlite;
}
mod root;
use crate::auth::cache::AuthCache;
use crate::common::config::AirdayConfig;
use crate::common::sql::Db;
use axum::Router;
use axum::extract::MatchedPath;
use axum::http::{Method, Request};
use axum::routing::{any, get, post, put};
use bpaf::Bpaf;
use std::fs;
use tower_cookies::CookieManagerLayer;
use tower_http::cors::{Any, CorsLayer};
#[cfg(test)]
pub mod test_util;
use tower_http::trace::TraceLayer;
use tracing::{info, info_span};

#[derive(Clone)]
struct AppState {
    db: Db,
    config: AirdayConfig,
    ws: sync_transport::websocket::WebsocketState,
    auth_cache: AuthCache, // ws_sub_map: sync::websocket::WSSubMap,
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
    log_level: Option<String>,
}

#[tokio::main]
async fn main() {
    // Config
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
    if let Some(log_level) = opts.log_level {
        cfg.log_level = log_level.to_lowercase();
    }

    telemetry::otlp::setup(&cfg);

    // Database
    // TODO: Match config to make correct connection (pg vs sql)
    let db = common::sql::connect_sqlite(&cfg).await;

    // App state
    let state = AppState {
        db: db,
        config: cfg.clone(),
        ws: sync_transport::websocket::WebsocketState::new(),
        auth_cache: AuthCache::new(),
    };

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any)
        .allow_origin(Any);

    let public = Router::new()
        .route("/", get(root::root_handler))
        .route(
            "/auth/password",
            post(auth::auth::password_authorisation_cookie),
        )
        .route(
            "/auth/password/bearer",
            post(auth::auth::password_authorisation_bearer),
        )
        .route("/user", post(auth::auth::create_user));
    let private = Router::new()
        .route("/auth/refresh", post(auth::session::refresh_session_cookie))
        .route(
            "/auth/refresh/bearer",
            post(auth::session::refresh_session_bearer),
        )
        .route("/user", put(user::model::update_user_handler))
        .route("/auth/sessions", post(auth::session::get_user_sessions));
    // .route("/ws", any(sync_transport::websocket::handler));

    let listener = tokio::net::TcpListener::bind(format!("{}", host_str))
        .await
        .unwrap();

    let app = Router::new()
        .merge(private)
        .merge(public)
        .with_state(state)
        .layer(cors)
        .layer(CookieManagerLayer::new())
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request<_>| {
                let matched_path = request
                    .extensions()
                    .get::<MatchedPath>()
                    .map(MatchedPath::as_str);

                // Consider request.uri() or OriginalUri for real path, as opposed to matched
                info_span!(
                    "http_request",
                    method = ?request.method(),
                    matched_path,
                    some_other_field = tracing::field::Empty,
                )
            }),
        );

    info!(port = 3000, address = "0.0.0.0", "Starting Airday server");
    axum::serve(listener, app).await.unwrap();
}
