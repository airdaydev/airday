## Operation Phoenix

Greenfield rebuild of Airday. The repo has been gutted: every prior tree (`server/`, `js/`, `flatbuffers/`, `web/`, `ios/`, root `Cargo.toml`, `package.json`) has been renamed to `*-legacy/` or `*.legacy`. Sprint 1 is being built from scratch.

## Source of truth

- `phoenix.md` — sprint 1 thesis, scope, deliverable. Read this first.
- `spec/*.md` — the contract for what's being built. **Before implementing anything, read the relevant spec.** Specs supersede `phoenix.md` where they disagree (specs are more recent).
  - `architecture.md`, `auth.md`, `cli.md`, `data-model.md`, `encryption.md`, `storage.md`, `sync-protocol.md`, `testing.md`
- `../cooee` — sibling repo on similar but stronger foundations. Useful reference for patterns.

## Legacy rule

Anything under `*-legacy/` or named `*.legacy` is **reference-only**. Read it to crib patterns or recall prior decisions; do not edit it, do not grep it for current behaviour, do not import from it. The current implementation is whatever lives in (eventually) `core/`, `server/`, `cli/`, `crates/protocol/` — see `spec/architecture.md`.

## Sprint 1 scope

**In:** Rust workspace — `core/` (Loro CRDT + E2EE + sync engine, native + wasm targets), `server/` (sqlite-backed dumb relay + auth + WS), `cli/` (first client + integration test surface), `crates/protocol/` (shared wire types). MessagePack on the wire everywhere (HTTP + WS). E2EE with password-derived KEK wrapping a DEK; recovery code in scope, server-assisted escrow deferred.

**Out:** postgres, multi-tenant, SaaS billing, web/iOS/Android/macOS clients, flatbuffers, MCP, native app deployment. These live in `roadmap.md` for later sprints.

## Build & run

Root `package.json` is a Bun workspace (`js/*`) with thin script wrappers — there is no JS to build, the scripts just front cargo and the config generator:

- `bun run config` — render `local/server.toml` from `js/config/templates/` (see `js/config/README.md`); `local/` holds gitignored dev artifacts
- `bun run server` / `bun run cli` — `cargo run -p airday-server --` / `cargo run -p airday --`; pass flags after the script name (e.g. `bun run server -- --bind 0.0.0.0:8000`)
- `bun run build` / `bun run test` / `bun run fmt` / `bun run lint` — cargo equivalents
- `bun run build:wasm` — `wasm-pack build core/`. Always use this from the workspace root; bare `cargo build --target wasm32-...` will try to build `server`/`cli` for wasm and fail.
- `bun run typecheck` — `tsc --noEmit -p js/config`
