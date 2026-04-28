# Testing

Sqlite-only for sprint 1. No mocked database. No mocked server. The test pyramid skews heavy on E2E because the server-is-dumb thesis means there isn't much logic to unit-test in isolation — convergence and protocol behavior are emergent from the whole system.

## Layers

1. **Unit tests** (`#[test]` in each crate)
   - Encryption primitives (KEK derivation, wrap/unwrap, AEAD round-trip)
   - Loro mutation helpers
   - ID generation, prefix-matching
2. **Server integration tests** (`server/tests/`)
   - Real server, real sqlite (temp file or `:memory:`)
   - Drives HTTP + WS via reqwest + tungstenite
   - Asserts protocol behavior (op_id assignment, ack tracking, snapshot triggering)
3. **End-to-end tests** (`e2e/` at workspace root)
   - Real server + N CLI subprocesses
   - Drives CLI via stdin and `--json` stdout
   - Asserts state convergence across devices

E2E is the load-bearing surface. Required matrix for sprint 1:

- signup → add items → exit → re-login → items still there
- two clients live → mutations on A appear on B within bounded time
- A offline, makes mutations, comes online → mutations appear on B
- A and B both offline making mutations → both come online → both converge to same Loro state
- snapshot threshold reached → snapshot taken → fresh device joins → pulls snapshot + tail successfully
- recovery code flow → new password works → DEK preserved → items intact

## Helpers

- `TestServer` — RAII handle, starts a server on a random port with a temp sqlite, exposes URL, kills on drop.
- `TestCli` — spawns `airday` subprocess with isolated `XDG_DATA_HOME` and a stub keychain backend, exposes typed methods that wrap `--json`.
- `wait_for(predicate, timeout)` — bounded polling helper. **Avoid raw `sleep`s in tests.**

## Determinism

Where possible, expose a server-side "test event stream" (e.g. `--test-events <unix-socket>`) emitting `op_persisted`, `snapshot_requested`, `snapshot_uploaded`. Tests subscribe and react instead of polling.

## Open questions

- Property tests for sync convergence (random op streams across N clients)?
- Should we require byte-stable Loro snapshots across replicas (depends on Loro peer-id determinism)?
