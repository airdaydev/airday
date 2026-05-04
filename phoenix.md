# Operation Phoenix

Sprint 1 of the v1.0 build. "Phoenix" because we are stripping the existing repo to bare metal and rebuilding from honest constraints.

## Thesis

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

## Sprint 1 deliverable

A real user can, from CLI on two machines and a browser session sharing the same account:

- Sign up, log in, log out, change password
- Add, edit, move, bin, restore items across the reserved primary list and user-created lists
- Sync over WS in real time across CLI ↔ CLI and CLI ↔ web
- Recover via recovery code after wiping a device; new password preserves data
- Have it all be E2EE against a sqlite-backed server

End-to-end integration tests prove this with a real server + multiple CLI clients. The web client is exercised manually for sprint 1; a Playwright harness is deferred until the UI surface stabilises. No deployment infra, no SaaS-specific code (postgres, billing, multi-tenant).

### Sprint 1 follow-ups

In scope for the sprint, not yet green; tracked in `roadmap.md`:

- **Snapshot orchestration end-to-end.** Wire types exist; the server's WS handler currently logs and ignores `PushSnapshot` / `PullSnapshot` / `SnapshotRequest`. Need server-side threshold check, client serialize+seal+upload, and the compaction job.
- **E2E coverage gaps from `spec/testing.md`** — offline-mutate-then-sync, both-offline-then-converge, snapshot-bootstrap-fresh-device, recovery-flow round-trip.
- **Web reconnect backoff** (currently fixed-delay) and **Argon2id in a worker** so login doesn't block the main thread.

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
| [`spec/cli.md`](spec/cli.md) | Commands, local key storage, device bootstrap UX |
| [`spec/testing.md`](spec/testing.md) | Integration test pattern, CLI driver |
| [`spec/saas.md`](spec/saas.md) | Sprint 2+ contract: browser signup device flow, lapsed-account lifecycle, self-hosted migration |

Out of scope for sprint 1 (live in `roadmap.md`): postgres + multi-tenant, SaaS billing, multi-region, MCP, native apps, device priority targeting, pricing, Vault-backed escrow.
