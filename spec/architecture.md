# Architecture

## Crate layout

```
Cargo.toml         workspace root
crates/
  protocol/        shared wire types (serde + rmp-serde)
core/              rust lib — loro, e2ee, sync engine. native + wasm targets.
core/web/          wasm-bindgen surface (excluded from default-members)
server/            rust bin — http + ws, sqlite-backed, dumb relay
cli/               rust bin — depends on core, integration test surface
```

Single workspace for sprint 1. Always invoke wasm builds as `wasm-pack build core/` (never bare `cargo build --target wasm32-...` at root, which would try to build server/cli for wasm and choke).

**Split plan:** when `crates/protocol/` reaches a stable shape (sprint 3 / v1.0), extract `core/` + `crates/protocol/` into a separate FOSS repo; `server/` consumes via git submodule + path dep. Defer until then — the workspace's atomic cross-crate refactor benefits dominate during high-churn early development.

## Build targets

- `core` builds for: native (linux/mac/windows) and `wasm32-unknown-unknown`.
- WASM build via `wasm-pack`; web bindings live in `core/web/` (out of scope sprint 1, but layout reserves the place).
- `server` and `cli` are native-only.

## Server-is-dumb thesis

The server **cannot**:
- read op contents (opaque encrypted blobs)
- run a Loro doc
- validate op semantics
- compute snapshots

The server **can**:
- authenticate accounts and devices
- assign monotonic op ids
- track per-device `last_acked_op_id`
- compute horizon = min(`last_acked_op_id`) across active devices
- decide when a snapshot is due (op-count threshold past last snapshot)
- pick the most-acked active client to produce the snapshot
- replace prior snapshots and prune ops below the horizon

This thesis is load-bearing for everything in `sync-protocol.md`.

## Wire encoding

All HTTP bodies and all WebSocket frames are **MessagePack** (`rmp-serde`). Single encoding everywhere; same `#[derive(Serialize, Deserialize)]` types as everything else. Native byte support means no base64-wrap of encrypted blobs. MessagePack's tagged-map semantics give us free additive compat (add a field → old decoders ignore it; remove a field → use `Option`).

`Content-Type: application/msgpack` on HTTP. WS frames are binary.

A `cargo run -p airday -- decode <file>` debug subcommand pretty-prints any captured frame as JSON for inspection (and, given the DEK, can decrypt op blobs in the same pass).

