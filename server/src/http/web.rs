//! Embedded web client (feature `bundled-web`).
//!
//! The built vite bundle in `js/web/dist` is baked into the binary at compile
//! time and served from `/`, `/index.html`, and `/assets/*`. Anything else is
//! left to the rest of the router (the API routes) or 404s — there is no SPA
//! fallback, so unknown paths under `/` are a plain 404.

use axum::extract::Path;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use rust_embed::RustEmbed;

use crate::state::AppState;

#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../js/web/dist"]
struct WebAssets;

/// Routes that serve the embedded web client. Merged into the main router only
/// when `bundled-web` is enabled.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(index))
        .route("/index.html", get(index))
        .route("/assets/{*path}", get(asset))
}

// The entry point is revalidated each load; the asset filenames are
// content-hashed by vite, so they're safe to cache indefinitely.
const INDEX_CACHE: &str = "no-cache";
const ASSET_CACHE: &str = "public, max-age=31536000, immutable";

async fn index() -> Response {
    serve("index.html", INDEX_CACHE)
}

async fn asset(Path(path): Path<String>) -> Response {
    serve(&format!("assets/{path}"), ASSET_CACHE)
}

fn serve(path: &str, cache: &'static str) -> Response {
    match WebAssets::get(path) {
        Some(file) => (
            [
                (header::CONTENT_TYPE, file.metadata.mimetype().to_owned()),
                (header::CACHE_CONTROL, cache.to_owned()),
            ],
            file.data.into_owned(),
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
