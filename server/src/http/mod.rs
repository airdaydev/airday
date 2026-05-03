pub mod msgpack;
pub mod request_id;

mod auth_routes;
mod device_routes;

use axum::http::{header, Method};
use axum::middleware;
use axum::routing::{any, delete, get, post};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};

use crate::state::AppState;
use crate::sync::ws_handler;

pub const MSGPACK_CONTENT_TYPE: &str = "application/msgpack";

pub fn router(state: AppState) -> Router {
    // Permissive CORS for slice 4: the dev web client runs on
    // localhost:5173 and talks to localhost:8000. Tighten when we add
    // a hosted deployment.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            request_id::REQUEST_ID_HEADER,
        ])
        .expose_headers([request_id::REQUEST_ID_HEADER]);

    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/account/signup", post(auth_routes::signup))
        .route("/api/account/prelogin", post(auth_routes::prelogin))
        .route("/api/account/login", post(auth_routes::login))
        .route("/api/account/recover", post(auth_routes::recover))
        .route("/api/account/logout", post(auth_routes::logout))
        .route(
            "/api/account/password/change",
            post(auth_routes::password_change),
        )
        .route(
            "/api/account/password/reset",
            post(auth_routes::password_reset),
        )
        .route(
            "/api/devices",
            get(device_routes::list).post(device_routes::register),
        )
        .route("/api/devices/{device_id}", delete(device_routes::revoke))
        .route("/api/sync", any(ws_handler))
        .layer(middleware::from_fn(request_id::middleware))
        .layer(cors)
        .with_state(state)
}
