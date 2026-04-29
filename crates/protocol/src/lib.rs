//! Wire types shared across `airday-server`, `airday-core`, and `airday`.
//!
//! All types are MessagePack-encoded via `rmp-serde` on both the HTTP
//! and WebSocket paths. Byte fields use `serde_bytes` so MessagePack
//! emits its native `bin` family rather than a sequence of u8s.

pub mod auth;

pub use auth::*;
