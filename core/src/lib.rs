//! Airday core: encryption + (later) Loro CRDT engine + sync logic.
//!
//! Sprint 1 currently exposes only the auth-time crypto primitives.
//! The Loro doc and sync engine arrive once the auth crust is solid.

pub mod crypto;

pub use crypto::*;
