# Local Storage — Implementation Plan

## Goal

Replace the bespoke per-platform persistence layers (`cli/migrations/001_init.sql`'s single-row `docs` blob, the web client's `IdbWalStorage` + OPFS-snapshot split) with **one Rust trait** in `core/` and two implementations that satisfy it:

- **CLI** (and future server-side single-account flows): native sqlite, file on disk.
- **Web**: IndexedDB, main-thread, no Worker. The engine stays on the main thread; the trait's JS binding hides the IDB calls behind the same shape the engine uses on the native side.

The trait is the load-bearing change — it's what makes "two platforms, same engine, same semantics" possible. Both implementations end up small once the trait is correct.

## Key learnings (from a prior attempt — read before designing)

A prior branch (`spike/shared-worker`, preserved for reference) tried to unify both platforms on **sqlite via sqlite-wasm + OPFS-SAH-pool** inside a SharedWorker. It worked end-to-end but was abandoned. The lessons are durable:

1. **`createSyncAccessHandle` is DedicatedWorker-only per WHATWG spec.** Not a vendor bug — the spec explicitly restricts it to `DedicatedWorkerGlobalScope`. SharedWorkers cannot host OPFS-backed sqlite in any browser. Sources: [MDN `createSyncAccessHandle`](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle), [wa-sqlite discussion #81](https://github.com/rhashimoto/wa-sqlite/discussions/79). **Don't propose this combination again.**
2. **sqlite-wasm on web is +1 MB bundle, plus COOP/COEP headers, plus a Worker boundary on the storage hot path.** None of those costs buy us anything the engine actually needs — we store opaque encrypted blobs, not query data. IDB is exactly the right shape (ordered keyed store with transactions) and ships in every browser, free.
3. **Moving the engine off the main thread costs round-trip latency on every mutation.** Even with the broadcast subscription pattern and FIFO postMessage, the lag is perceptible in tight UI loops (typing, drag-reorder). Multi-tab coherence and Argon2id-off-main are real wins, but not worth the UX regression. Web engine stays on main.
4. **The trait abstraction is the prize, not the unified storage technology.** "Same Rust engine, same boot semantics, same op log, same snapshot policy" is what made the spec valuable. The implementation can be sqlite on one side and IDB on the other — the engine never knows.

## Target architecture

```
                    LocalStorage trait (core/src/storage.rs)
                              │
              ┌───────────────┴───────────────┐
              │                               │
        SqliteStorage                    IdbStorage (JS impl
        (native, rusqlite)                behind a wasm-bindgen
                                          extern interface)
              │                               │
        CLI / server-                   Web (main thread)
        side accounts
```

The trait shape mirrors the data model already specified in the spec it replaces (single `docs`, append-only `ops` log keyed by `(doc_id, local_seq)`, one `snapshots` row per doc). Implementations differ in their substrate, not their semantics.

## Phased plan

### Phase 0a — Define the trait + plumb it through `SyncEngine` *(done)*

`core/src/storage.rs` defines:

- Newtypes: `DocId(Uuid)`, `ClientOpId(Uuid)`, `LocalSeq(u64)`, `ServerSeq(u64)`.
- Row types: `LocalOpRow`, `RemoteOpRow`, `OutboxRow`, `ReplayRow`, `SnapshotRow`, `BootState`. No `created_at` field — engine is clock-free, impls supply timestamps (sqlite `unixepoch()`, JS `Date.now()`, MemStorage zero).
- `StorageError` (`Backend` / `DocNotFound` / `UnknownClientOpId`).
- `LocalStorage` trait with `boot` / `append_local_op` / `append_remote_op` / `ack_local_op` / `outbox` / `write_snapshot`. All methods take `&self` so impls can use interior mutability (sqlite `Mutex<Connection>`, JS handle by-reference).
- `MemStorage` — in-memory test double, substrate for `core/`'s engine tests.
- `NoopStorage` — empty-results stub used while hosts migrate; deleted in Phase 3.
- `impl<T: LocalStorage + ?Sized> LocalStorage for Arc<T>` — lets tests share one storage handle between the engine and the test body.

```rust
pub trait LocalStorage {
    fn boot(&self, doc_id: DocId) -> Result<BootState, StorageError>;
    fn append_local_op(&self, doc_id: DocId, row: LocalOpRow) -> Result<LocalSeq, StorageError>;
    fn append_remote_op(&self, doc_id: DocId, row: RemoteOpRow) -> Result<LocalSeq, StorageError>;
    fn ack_local_op(&self, doc_id: DocId, client_op_id: ClientOpId, server_seq: ServerSeq) -> Result<(), StorageError>;
    fn outbox(&self, doc_id: DocId) -> Result<Vec<OutboxRow>, StorageError>;
    fn write_snapshot(&self, doc_id: DocId, up_to_local_seq: LocalSeq, payload: EncryptedBlob) -> Result<(), StorageError>;
}
```

`SyncEngine` grows a `storage: DynStorage` field. `DynStorage = Box<dyn LocalStorage + Send>` on native, `Box<dyn LocalStorage>` on wasm (wasm is single-threaded and `JsValue`-holding impls are `!Send` by construction — the bound flips off via `#[cfg(target_arch = "wasm32")]`). `SyncEngine::new` accepts it. Held but not yet called.

CLI and web both construct `Box::new(NoopStorage)`. Zero behavior change.

### Phase 0b — Engine fires trait calls as observers *(done)*

`SyncEngine::new` additionally takes `doc_id: DocId`. CLI passes its existing `primary_doc_id`; web passes `session.primaryDocId` through the wasm constructor (`new SyncEngine(doc, docId, dek, lastAcked, clientName, clientVersion)`).

The engine fires the trait at three transitions:

- `try_start_push`: mints a `ClientOpId`, calls `storage.append_local_op` with the sealed delta from `pending_export`, remembers the id in `in_flight_client_op_id` alongside `in_flight_push_vv`.
- `OpsAck` handler: calls `storage.ack_local_op(remembered_id, ServerSeq(assigned_seqs[0]))`. `try_start_push` always pushes one blob, so the first seq is the one.
- `apply_remote_ops`: calls `storage.append_remote_op(ServerSeq(op.seq), op.blob.clone())` for each blob in the batch.
- `go_disconnected` clears `in_flight_client_op_id` — the storage row stays unacked for outbox-driven re-push (Phase 1+); the engine just drops the in-memory tracker so a stale OpsAck in a fresh session can't ack a row from a prior one.

Legacy `pending_export` / `mark_pushed_at` / `notify_wal_durable` remain the source of truth for what goes on the wire. `NoopStorage` on CLI/web swallows the observer calls — no behavior change. Three new `MemStorage`-driven tests in `core/src/sync.rs` lock in that the trait is being fed correctly:

- `push_appends_local_op_row_then_ack_clears_outbox`
- `apply_remote_ops_appends_one_row_per_blob`
- `disconnect_mid_push_leaves_storage_row_unacked`

**Granularity caveat (carried into Phase 1):** each `try_start_push` produces *one* storage row covering the merged blob from `pending_export` — so N committed ops between flushes collapse into a single `local_op` row with a single `client_op_id`. Spec's per-op intent is unmet. Phase 1 either accepts per-push granularity (simpler, matches current wire shape) or grows a per-commit hook so each `doc.add_item` produces its own row. Decide before SqliteStorage's schema is locked in.

### Phase 1 — `SqliteStorage` for CLI + load-bearing cutover

Two coupled pieces of work, since the trait stops being an observer here:

1. **Implement `SqliteStorage`** in `cli/src/storage.rs` (new) using `rusqlite`. Schema below.
2. **Migrate the engine's push path** from `pending_export` / `mark_pushed_at` to `storage.outbox()` / `storage.ack_local_op()`. `try_start_push` reads outbox rows and ships them as separate blobs in `PushOps.ops`; the server's `OpsAck.assigned_seqs[i]` aligns with `ops[i]` and the engine acks each row by its `client_op_id`. `Doc::last_pushed_vv` and `pending_export` stay in `core/` (web still uses them in Phase 1) but the CLI no longer calls them.

Granularity choice from Phase 0b's caveat is settled here.

Schema from the existing local-storage data-model spec:

```sql
CREATE TABLE docs (id BLOB PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE ops (
  doc_id BLOB NOT NULL REFERENCES docs(id),
  local_seq INTEGER NOT NULL,
  client_op_id BLOB,
  server_seq INTEGER,
  payload BLOB NOT NULL,
  payload_nonce BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, local_seq)
);
CREATE UNIQUE INDEX ops_client_op_id_idx ON ops (doc_id, client_op_id) WHERE client_op_id IS NOT NULL;
CREATE UNIQUE INDEX ops_server_seq_idx ON ops (doc_id, server_seq) WHERE server_seq IS NOT NULL;
CREATE TABLE snapshots (
  doc_id BLOB PRIMARY KEY REFERENCES docs(id),
  up_to_local_seq INTEGER NOT NULL,
  payload BLOB NOT NULL,
  payload_nonce BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
```

Pragmas: `WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000` — match the server side per `spec/storage.md`.

Migration `002_local_storage` replaces `001_init`'s single-row `docs(payload)` table. One-shot copy of the old blob into a fresh `snapshots` row on first boot under the new schema; drop the old table.

CLI boots through the trait. `cli/src/db.rs` becomes thin — open the file, hand a `SqliteStorage` to the engine.

**Exit criteria:** CLI builds, tests pass against the new schema, every CLI smoke test (signup, add, sync, restart, replay) works through the trait.

### Phase 2 — `IdbStorage` for web (main thread)

JS implementation behind a wasm-bindgen extern interface passed to `SyncEngine::new`. Lives somewhere like `js/core/src/storage/idb-storage.ts`.

IDB schema (mirrors the sqlite logical shape; IDB partial-unique indexes fall out for free because IDB excludes records where any compound-key element is `undefined`):

```ts
db: "airday-engine", version: 1
objectStores:
  docs:      keyPath = "id"
  ops:       keyPath = ["docId", "localSeq"]
             indexes:
               docIdClientOpId  (["docId","clientOpId"], unique=true)
               docIdServerSeq   (["docId","serverSeq"],  unique=true)
  snapshots: keyPath = "docId"
```

Reference implementation existed on the `spike/shared-worker` branch at `js/web/src/worker/idb-store.ts` — schema setup is verbatim usable; the harness wrap-up (encrypt with DEK, append on commit, replay on boot) is also reusable. Just delete the worker scaffolding around it; the same code runs on the main thread.

The DEK seal/open round-trip:
- On commit: `engine.exportUpdatesAfter(cursor)` → plaintext → `dek.seal(bytes)` → store `{ciphertext, nonce}` as an `ops` row. Advance `cursor = engine.oplogVvBytes()`.
- On boot: read snapshot row (if any) → `dek.open(blob)` → `Doc.load(plaintext)`; then iterate `ops` rows in `localSeq` order → `dek.open` → `doc.importWalUpdates(plaintext)`. Construct `SyncEngine` from the populated `Doc`.

The existing `airday-web` IDB database (vault + idb-wal + prefs) stays untouched in this phase. The new `airday-engine` database is fresh; no live migration needed for development. **For users with real data: a one-shot drain from the old `ops` + OPFS `loro.bin` into the new schema runs at first boot under the new code, then deletes the legacy stores.** The reference for that migration also lives on the spike branch (`worker/migration.ts` shape, minus the worker wrapper).

**Exit criteria:** web builds, anonymous + authed sessions work end-to-end, reload survives, multi-tab works as it does today (single tab via `navigator.locks` — *not* trying to be multi-tab-coherent, that's a separate effort).

### Phase 3 — Cleanup

After Phase 2 is verified in real use:

- Delete `core::NoopStorage` (and its hosts' construction sites) once CLI and web are on real impls.
- Delete `Doc::pending_export`, `Doc::mark_pushed_at`, `Doc::last_pushed_vv` from `core/src/doc.rs` — `storage.outbox()` / `storage.ack_local_op()` have taken over their job.
- Decide on the durability callback (`notify_wal_durable` today): keep it as the IDB flush signal (web only needs it; sqlite is synchronously durable) or fold it into the trait via a callback handle. Either is fine; pick when Phase 2 lands.
- Delete `js/core/src/storage/idb-wal.ts`, `wal-adapter.ts`, `mem-wal.ts`, `wal-bridge.ts`.
- Delete the OPFS-snapshot code path in the legacy storage.
- Delete the v1–v6 schema-bump branches in `js/core/src/storage/web-db.ts` — only the vault + prefs stores survive there (or fold those into `airday-engine` if it makes sense).
- Drop `spec/idb-wal.md` (already superseded by the data-model section in this plan / resurrected `spec/local-storage.md`).
- Update `spec/architecture.md` to point at the trait.

## Verification

- All existing `cargo test`s pass.
- All existing `bun test` suites pass (especially `js/web/test/search.test.ts` which feeds `AppEvent`s through the dispatcher — the trait shouldn't affect that path).
- Manual: sign up, add items, switch lists, edit, undo, reload, log out, log back in — every flow survives.
- Sync: two devices (CLI + web, or two CLI instances) converge through the server.
- Migration: snapshot a real `airday-web` IDB + OPFS profile from current code, boot on new code, verify state survives the one-shot drain and legacy stores are deleted after commit.

## What's explicitly out of scope

- **Multi-tab coherence on web.** One engine, one tab. The `navigator.locks` single-tab gate stays.
- **Engine in a worker.** Stays on the main thread for the latency reasons in the learnings section.
- **Argon2id off the main thread.** Will block UI for ~hundreds of ms on login. Acceptable for now; can be solved later with a dedicated worker just for the KDF without disturbing the engine.
- **sqlite on web.** Not happening unless the SAH spec changes. See learnings.

## Reference branch

`spike/shared-worker` (this user's machine) contains:
- A working IDB schema with the exact shape Phase 2 needs (`js/web/src/worker/idb-store.ts`).
- A working DEK-seal/replay loop (`js/web/src/worker/engine-harness.ts`'s `replayDoc` + `queuePersist`).
- The shape of the `EngineStorage` extern type added to `core/web/src/lib.rs` for the wasm-bindgen surface.

Don't port the SharedWorker / RPC / broadcast / proxy machinery — those exist to solve a problem we're no longer solving.
