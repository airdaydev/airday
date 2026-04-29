pub mod msgpack;

mod auth_routes;
mod device_routes;

use axum::routing::{delete, get, post};
use axum::Router;

use crate::state::AppState;

pub const MSGPACK_CONTENT_TYPE: &str = "application/msgpack";

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/account/signup", post(auth_routes::signup))
        .route("/api/account/prelogin", post(auth_routes::prelogin))
        .route("/api/account/login", post(auth_routes::login))
        .route("/api/account/recover", post(auth_routes::recover))
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
        .with_state(state)
}
