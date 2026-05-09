# Testing

Sqlite-only for now. No mocked database. No mocked server. The test pyramid skews heavy on E2E because the server-is-dumb thesis means there isn't much logic to unit-test in isolation — convergence and protocol behavior are emergent from the whole system.

## Layers

1. **Unit tests** (`#[test]` in each crate)
   - Encryption primitives (KEK derivation, wrap/unwrap, AEAD round-trip)
   - Loro mutation helpers
   - ID generation, prefix-matching
2. **CLI/system tests** (`cli/tests/`)
   - Primary home for happy-path end-to-end coverage
   - Real server + real sqlite + real `airday_cli` Rust client path (`net`, auth flows, `sync::Session`)
   - Covers account bootstrap and the normal multi-device lifecycle:
     - signup/login/recovery/password-change success paths
     - two-device sync and convergence
     - offline edits followed by catch-up
     - snapshot upload / snapshot bootstrap success paths
   - Reuse `cli/tests/support/mod.rs` as the shared harness for server startup, profile materialization, auth helpers, and bounded polling
   - Prefer long-lived `airday_cli::sync::Session` tests for snapshot/sync happy paths instead of ad hoc websocket clients
3. **Server integration tests** (`server/tests/`)
   - Real server, real sqlite (temp file or `:memory:`)
   - Drives HTTP + WS via thin ad hoc clients only where that is the point of the test
   - Narrowed to low-level server contract and adversarial/weird-client scenarios:
     - malformed or unexpected frames
     - auth rejection / unauthorized upgrade
     - handshake/version rejection
     - stale ack behavior
     - disconnect / timeout retry paths
     - direct broadcast / subscriber registry edge cases
     - exact wire-level protocol seams that are awkward to observe via `Session`

`core/tests/` stays focused on shared engine correctness and sans-IO sync behavior. Do not move whole-system server/CLI ownership questions into `core/tests/`.

E2E is the load-bearing surface. Required matrix:

- signup → add items → exit → re-login → items still there
- two clients live → mutations on A appear on B within bounded time
- A offline, makes mutations, comes online → mutations appear on B
- A and B both offline making mutations → both come online → both converge to same Loro state
- snapshot threshold reached → snapshot taken → fresh device joins → pulls snapshot + tail successfully
- recovery code flow → new password works → DEK preserved → items intact

Avoid duplicate happy-path coverage across `server/tests/` and `cli/tests/` unless the server-side test is proving a narrower wire-contract detail that the CLI-system test does not cover.

## Helpers

- `TestServer` — RAII handle, starts a server on a random port with a temp sqlite, exposes URL, kills on drop.
- `cli/tests/support/mod.rs` — shared CLI-system harness for server startup, profile materialization, auth helpers, device registration, and bounded polling.
- `wait_for(predicate, timeout)` — bounded polling helper. **Avoid raw `sleep`s in tests.**

## Convergence assertions

`core/` exposes `doc_fingerprint(doc) -> [u8; 32]` — a hash over the **canonical logical state** (items + lists + ordering + bin contents, walked in a deterministic order). Two replicas that have observed the same ops produce equal fingerprints; replicas that diverge produce different ones.

Use the fingerprint for E2E and property-test convergence checks instead of comparing snapshot bytes. Snapshot bytes are **not** required to be stable across replicas — Loro's serialization carries per-replica metadata (peer-ids, internal ordering) that legitimately differs even at logical equality, and per-snapshot encryption nonces would mask byte-stability anyway. Logical-state fingerprinting is the right granularity for "did we converge."

**Future:** a merkle chain/tree over the encrypted op stream is a separate, complementary primitive — commits to *causal history* rather than logical state, enabling O(log n) sync-diff and tamper-evident audit of the server's op log. Out of scope for now.

## Determinism

Where possible, expose a server-side "test event stream" (e.g. `--test-events <unix-socket>`) emitting `op_persisted`, `snapshot_requested`, `snapshot_uploaded`. Tests subscribe and react instead of polling.

## Open questions

- **Property-test the convergence guarantee** (`proptest`) — generate random scenarios consisting of (a) op streams across N simulated clients (add / move / edit / done / bin / list-create / list-delete) and (b) random partial sync events between random pairs of clients, then drain to a full sync at the end. Property: every client's final `doc_fingerprint` is equal. Loro promises logical convergence; we're stress-testing *our integration* (sync engine, frontier tracking, snapshot handoff, encryption framing) — example tests miss the interleavings that find bugs here. Worth doing once the e2e matrix is green.
