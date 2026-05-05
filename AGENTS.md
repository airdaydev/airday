## Product Thesis

Airday is the lowest-friction, FOSS, single-human-user, E2EE, multi-device intent/capture/log tool. Capture is the entire point — anything that gets in the way of capturing or sorting is wrong.

Workflow: a reserved primary capture list ("Desk", id `main`), any number of user-created lists (a "Later" list is seeded on signup), and a bin. Items move between lists, can be done, binned, restored, and deleted.

## Architecture

- **Rust core** (`core/`) — Loro CRDT, E2EE, sync engine. Compiles to native (CLI, server) and WASM (web) via `core/web/`.
- **Rust server** (`server/`) — sqlite-backed, sequenced encrypted-blob store + auth + WS relay. The server is *dumb*: it cannot read op contents, cannot run a Loro doc, cannot validate semantics. Its job is auth, ordering, durability, frontier tracking, snapshot orchestration.
- **CLI** (`cli/`) — sprint 1's reference integration test surface.
- **Web** (`js/web/`, consuming `core/web/` wasm via `js/core/`) — second sprint-1 client; multi-device proof spans CLI ↔ web.
- **iOS / Android / native macOS** — out of sprint 1.

E2EE: password-derived KEK wraps a randomly-generated DEK. DEK encrypts every op blob. Server has no key. Recovery via a user-held recovery code (independent wrap of DEK) is in scope for sprint 1; server-assisted escrow (Vault-backed, opt-in) is sprint 2+.

Sync: WebSocket per device. Auth on upgrade. Ops are append-only encrypted blobs with server-assigned monotonic ids. Each device tracks its `last_acked_op_id`; the minimum across active devices is the compaction horizon. Snapshots are produced by the most-acked active client on server request.

## Source of truth

- `phoenix.md` — sprint 1 thesis, scope, deliverable. Read this first.
- `spec/*.md` — the contract for what's being built. **Before implementing anything, read the relevant spec.** Specs supersede `phoenix.md` where they disagree (specs are more recent).
  - `architecture.md`, `auth.md`, `cli.md`, `data-model.md`, `encryption.md`, `storage.md`, `sync-protocol.md`, `testing.md`
- `../cooee` — sibling repo on similar but stronger foundations. Useful reference for patterns.

## Specs

| File | Concern |
|---|---|
| [`spec/architecture.md`](spec/architecture.md) | Workspace layout, crate graph, server-is-dumb thesis |
| [`spec/encryption.md`](spec/encryption.md) | DEK / KEK / recovery code, wrap-states, password change |
| [`spec/crypto.md`](spec/crypto.md) | Cryptographic primitive inventory; companion to `encryption.md` |
| [`spec/auth.md`](spec/auth.md) | HTTP signup / login / recover, device register / revoke, token model |
| [`spec/sync-protocol.md`](spec/sync-protocol.md) | WS framing, push / pull / ack, frontier, snapshot orchestration |
| [`spec/storage.md`](spec/storage.md) | Sqlite schema, indexes, compaction policy |
| [`spec/data-model.md`](spec/data-model.md) | Loro doc layout, Item / ListMeta, status semantics |
| [`spec/search.md`](spec/search.md) | Local search index + command palette query contract |
| [`spec/cli.md`](spec/cli.md) | Commands, local key storage, device bootstrap UX |
| [`spec/testing.md`](spec/testing.md) | Integration test pattern, CLI driver |
| [`spec/saas.md`](spec/saas.md) | Sprint 2+ contract: browser signup device flow, lapsed-account lifecycle, self-hosted migration |

Out of scope for sprint 1 (live in `roadmap.md`): postgres + multi-tenant, SaaS billing, multi-region, MCP, native apps, device priority targeting, pricing, Vault-backed escrow.

**Future concerns:** postgres, multi-tenant, SaaS billing, web/iOS/Android/macOS clients, MCP, native app deployment. These live in `roadmap.md` for later sprints.

## Build & run

Root `package.json` is a Bun workspace (`js/*`) with thin script wrappers — there is no JS to build, the scripts just front cargo and the config generator:

- `bun run config` — render `local/server.toml` from `js/config/templates/` (see `js/config/README.md`); `local/` holds gitignored dev artifacts
- `bun run server` / `bun run cli` — `cargo run -p airday-server --` / `cargo run --release -p airday --`; pass flags after the script name (e.g. `bun run server -- --bind 0.0.0.0:8000`). `bun run cli:dev` for the debug build (faster compile, much slower sync on real-sized docs)
- `bun run build` / `bun run test` / `bun run fmt` / `bun run lint` — cargo equivalents
- `bun run build:wasm` — `wasm-pack build core/`. Always use this from the workspace root; bare `cargo build --target wasm32-...` will try to build `server`/`cli` for wasm and fail.
- `bun run typecheck` — `tsc --noEmit -p js/config`
