//! Embedded web client (feature `bundled-web`).
//!
//! The built vite bundle in `js/web/dist` is baked into the binary at compile
//! time and served from `/`, `/index.html`, `/assets/*`, and the root-level
//! files vite copies out of `js/web/public` (favicons, the web manifest, and
//! `icons/*`). Anything else is left to the rest of the router (the API
//! routes) or 404s — there is no SPA fallback, so unknown paths under `/` are
//! a plain 404.

use axum::Router;
use axum::extract::Path;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
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
        .route("/icons/{file}", get(icon))
        .route("/{file}", get(root_file))
}

// The entry point is revalidated each load; the asset filenames are
// content-hashed by vite, so they're safe to cache indefinitely. Icons and
// the manifest are not hashed, but they change rarely — a day of staleness
// on an app icon is harmless, and the manifest is cheap to revalidate.
const INDEX_CACHE: &str = "no-cache";
const ASSET_CACHE: &str = "public, max-age=31536000, immutable";
const ICON_CACHE: &str = "public, max-age=86400";
const MANIFEST_CACHE: &str = "no-cache";

async fn index() -> Response {
    serve("index.html", INDEX_CACHE)
}

async fn asset(Path(path): Path<String>) -> Response {
    serve(&format!("assets/{path}"), ASSET_CACHE)
}

async fn icon(Path(file): Path<String>) -> Response {
    serve(&format!("icons/{file}"), ICON_CACHE)
}

// Single-segment catch-all for the files vite copies from `public/` into the
// bundle root. Static routes (`/healthz`) and multi-segment routes (`/api/*`)
// take precedence in axum's matcher, so this only sees names nothing else
// claimed; unknown ones 404 out of `serve` exactly as before.
async fn root_file(Path(file): Path<String>) -> Response {
    let cache = if file == "manifest.webmanifest" {
        MANIFEST_CACHE
    } else {
        ICON_CACHE
    };
    serve(&file, cache)
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
