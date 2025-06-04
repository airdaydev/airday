# Airday server exploration

This is v0 of Airday's backend in Rust.

## Likely dependencies
- tokio (async runtime)
- axum (web framework)
- axum-extra (cookie extraction)
- serde (serialisation, deserialisation)
- chrono (tz package)
- chrono-tz (tz extension?)
- validator (validate requests)
- uuid (id generation)
- sqlx (sqlite)
- automerge (maybe)

## Roadmap
- [] core
- [] hardcoded auth
- [] sqlite
- [] e2e contacts
- [] tracing
- [] basic auth (front-end sign in, up, user management)
- [] todo
- [] oauth
- [] basic cal
- [] hardcore cal
- [] ical import/export
- [] caldav

## Learning
- [x] https://tokio.rs/tokio/tutorial
- []
