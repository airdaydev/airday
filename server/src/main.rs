mod auth;
mod config;
mod jmap_core;
mod server;
mod sql;
use axum::{Router, middleware, routing::get};
use sqlx::SqlitePool;
use tower_cookies::CookieManagerLayer;

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
}

#[tokio::main]
async fn main() {
    let cfg = config::AirdayConfig::from_toml(
        "port = 3000\nhost = '0.0.0.0'\nsqlite_host='sqlite:/home/daniel/.config/airday/airday.db'",
    );
    let host_str = format!("{}:{}", cfg.host, cfg.port);

    let pool = sql::connect_sqlite(&cfg).await;

    let state = AppState { pool };

    println!("Airday server started at http://{}", host_str);
    let public = Router::new()
        .route("/", get(server::root_handler))
        .route("/auth/pw", get(auth::password_authorisation))
        .route("/user", get(auth::create_user));
    let private = Router::new()
        .route("/session", get(jmap_core::session_handler))
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
