# Sync Engine — sans-IO state machine

Plan for the next slice. Sequel to `wasm-plan.md`. Resolves the decision
that doc deferred ("lift the protocol state machine into Rust, vs keep
it in JS").

## Why now

`wasm-plan.md` left this open because slice 1 was just web. The plan
has since clarified: native macOS, iOS, Android **and** web are all
coming soon. That makes the decision easy.

Re-implementing the protocol state machine in TS + Swift + Kotlin is
the bug factory we'd otherwise sign up for. Loro+crypto+framing+sync
state lives in shared Rust; each platform is a thin transport + UI
shell.

| Platform     | Binding              | Transport                       |
|--------------|----------------------|---------------------------------|
| CLI          | native Rust          | tokio-tungstenite               |
| Web          | wasm-bindgen         | browser `WebSocket`             |
| macOS / iOS  | UniFFI → Swift       | `URLSession` / `NWConnection`   |
| Android      | UniFFI → Kotlin      | OkHttp `WebSocketListener`      |

UniFFI (Mozilla, used by Matrix SDK and Bitwarden) generates idiomatic
Swift/Kotlin from a Rust definition — handles `async`, errors, and
structs across the FFI without us hand-writing C ABI glue.

## Sans-IO shape

The engine doesn't await, doesn't own a socket, doesn't own a clock.
Caller pushes inputs in, drains outputs out.

```rust
pub struct SyncEngine { /* doc, dek, frontier, conn state, queues */ }

impl SyncEngine {
    pub fn new(doc: Doc, dek: Dek, last_acked_op_id: u64) -> Self;

    // -- transport callbacks (caller owns the socket) --
    pub fn handle_connected(&mut self);
    pub fn handle_server_bytes(&mut self, bytes: &[u8]);
    pub fn handle_disconnected(&mut self);
    pub fn handle_timeout(&mut self);

    // -- caller drives --
    pub fn flush(&mut self);
    pub fn pop_outbox(&mut self) -> Option<Vec<u8>>;
    pub fn pop_event(&mut self) -> Option<Event>;
    pub fn doc(&self) -> &Doc;
    pub fn doc_mut(&mut self) -> &mut Doc;
}

pub enum Event {
    ConnStateChanged { online: bool },
    PulledInitial,
    OpsApplied,
    Pushed,
    FrontierAdvanced { id: u64 },
    Error(String),
}
```

**Asymmetric buffering.** No input queue (each `handle_*` runs
synchronously to completion before returning). Two output queues: one
input commonly produces N outputs (e.g. `OpsBatch` → apply ops + emit
event + advance frontier + queue `Ack` frame).

## State machine

```
                          flush w/ pending
   Disconnected           ┌───────────────┐
        │                 │               ▼
   handle_connected       │           Pushing ─── on OpsAck ──┐
        ▼                 │             │  ▲                   │
       Hello              │       mutated │  │ ack arrived,    │
        │                 │       mid-push│  │ ack arrived &   │
     HelloAck             │               ▼  │ nothing more    │
        ▼                 │       PushingDirty                 │
     Pulling ── complete ─▶ Idle ◀──────────────────────────── ┘
        │
   broadcast frames apply in any state above Idle (no transition)
```

Disconnect from any state → `Disconnected`. The engine doesn't decide
*when* to reconnect — caller's policy (backoff, online detection,
visibility events).

## Batching & concurrency

Loro batches naturally: 1000 `addItem`s + 1 `flush()` = 1 `pending_export`
= 1 blob = 1 `PushOps` = 1 server-assigned op id. Server sees opaque
bytes, has no idea there are 1000 logical ops inside.

Two policies sit at the platform layer:
- **Debounce `flush()`** — 200ms after last mutation, plus on
  blur/visibility-hide. Belongs in JS / Swift / Kotlin, not the engine.
- **Reconnect** — per-platform, see above.

`PushingDirty` handles "user mutated mid-push": engine cannot
re-`pending_export` until `mark_pushed` advances `last_pushed_vv`, so
state stays `Pushing` and any further `flush()` calls just set the
dirty bit. On `OpsAck`: `mark_pushed` → if dirty, immediately
`pending_export` again and push the new range. No pipelining, no
double-export, no lost ops.

## Worker policy (web)

Engine stays on main thread for routine operation. Loro/crypto/frame
encode is microsecond-scale; postMessage round-trips would cost more
than they save.

Two specific heavy calls *do* warrant a worker, independently of the
engine:
- **Argon2id at login** — by design takes hundreds of ms. Flagged in
  `wasm-plan.md`. Worker, always.
- **Snapshot bootstrap on a fresh device** — possibly. Decide when
  snapshot orchestration ships.

Do not put the whole engine in a worker.

## Implementation slices

1. **`core/sync` module — sans-IO engine + tests**
   - `SyncEngine` API as above; frame encode/decode via `airday-protocol`.
   - Tests with a fake transport: push frames in, assert outbox + events.
   - Target: comprehensive coverage of every state transition + every
     error path. The CLI `Session` runtime tests give us a baseline of
     what scenarios matter.

2. **CLI refactor — drive sans-IO engine from tokio**
   - `cli/src/sync.rs` shrinks to ~50 lines of tokio-tungstenite glue.
   - All existing CLI integration tests stay green (push/pull/ack,
     offline short-circuit, two-device pull).
   - Validates the API for one real consumer before exposing it to
     three more.

3. **wasm-bindgen surface for `SyncEngine`**
   - `core/web` exposes `SyncEngine` alongside `Doc`/`Dek`/`EncryptedBlob`.
   - Browser-target build (`--target bundler` if Vite, else `--target web`).
   - Bun tests cover the FFI contract with a stub `WebSocket`.

4. **IDB adapter + first web client**
   - `js/core/src/storage/idb.ts`, modeled on `js-legacy/core/src/storage/idb.ts`.
   - Minimal one-screen UI: list / add / done / bin. Real sync from
     day one, not an offline demo.
   - DEK lifetime: in-memory only, re-derived from password each
     session.

5. **UniFFI bridge** (when iOS/Android start)
   - Same `core` crate, generated Swift + Kotlin bindings.
   - `ItemView` / `ListView` / `SyncEngine` cross the FFI as canonical
     types.

## Decisions (don't re-litigate)

- **Sans-IO over async.** Engine doesn't own time, sockets, threads.
  Each platform brings its own. CLI's tokio code is a thin adapter,
  not a separate implementation.
- **UniFFI**, not hand-written FFI for Swift/Kotlin.
- **Engine on main thread** in browsers; workers are for Argon2id and
  (maybe) snapshot bootstrap.
- **Push-input / pop-output API**, not `process(input) -> Vec<output>`.
  Better for FFI ergonomics, lazy drain.
- **No pipelining** of pushes. `PushingDirty` serializes. Latency cost
  is invisible; complexity savings are real.
- **No connect timeout in the engine.** Caller's job — JS uses
  `setTimeout`, CLI uses `tokio::time::timeout`. Engine exposes
  `handle_timeout()` for callers that want to escalate "handshake
  didn't complete" to an error event.
- **Auth lives outside the engine.** Bearer goes on the WS upgrade
  (CLI) or via short-lived ticket on the URL (browsers don't allow
  custom `Authorization` on `WebSocket`). Engine starts at
  `handle_connected()`; how the connection got authenticated is the
  platform's problem.

## Out of scope (later slices)

- Reconnect policy (backoff, online/offline, visibility).
- Snapshot orchestration (`SnapshotRequest`, `PushSnapshot`,
  server-side compaction). Pulled forward when freshness or device-2
  bootstrap force it.
- Argon2id worker for login.
- Password-derivation flow exposed across the same bindings.
- Browser auth ticket exchange (HTTP-then-WS pattern).
