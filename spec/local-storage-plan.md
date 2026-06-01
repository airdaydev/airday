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

### Phase 1 — `SqliteStorage` for CLI + load-bearing cutover *(done)*

**Granularity settled: per-push.** One `ops` row per flush — the merged sealed delta from
`pending_export`, one `client_op_id`, shipped as one blob → one server seq. `Doc` needs no
per-commit API; the CLI reuses `pending_export` + `mark_pushed_at` as a *capture cursor*. The
shared engine forks in `try_start_push`/`OpsAck` on whether `storage.outbox()` yields rows: the
CLI (`SqliteStorage`) ships outbox rows and acks them by `client_op_id`; web (`NoopStorage`, still
Phase 1) keeps an empty outbox and falls through to the legacy `pending_export` path unchanged.
New engine methods `capture_local_ops` (durable before any Ack) and `snapshot_if_fully_synced`
(compact once the outbox drains) drive CLI persistence; `cli/src/storage.rs`'s `boot_doc` rebuilds
the doc via `apply_remote_batch(snapshot + replay)`. Migration `002_local_storage` preserves the
old `docs(payload)` blob as `docs_legacy_v1` and the boot layer drains it into a sealed snapshot.
`Profile` lost `write_doc`/`read_doc`; the CLI dropped `tokio-rusqlite` for plain sync `rusqlite`.

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

### Phase 2 — `IdbStorage` for web (main thread) *(done)*

JS implementation behind a wasm-bindgen extern interface passed to `SyncEngine::new`. Lives at `js/core/src/storage/idb-storage.ts`.

**What actually landed (read before Phase 3 — the sketch below is partly superseded):**

- **`EngineStorage` extern + `WebStorage` adapter** in `core/web/src/lib.rs`. The trait is synchronous; IDB is async. `IdbStorage` keeps a **synchronous in-memory mirror** of the op log that the extern methods (`appendLocalOp` / `appendRemoteOp` / `ackLocalOp` / `outbox` / `writeSnapshot`) read/write immediately, and flushes IDB on a background promise chain. Durability is surfaced out-of-band via `IdbStorage.whenFlushed()` → host's `notifyWalDurable`. `WebStorage::boot` returns `BootState::default()` — the engine never calls `storage.boot()`; the host reconstructs the `Doc` in JS (see boot below).
- **`SyncEngine::new` gained an optional 7th arg** `storage?: EngineStorage`. Present → `WebStorage`; absent → `NoopStorage` (legacy `pending_export` path; still used by the js/core + js/web tests that construct the engine with 6 args).
- **New wasm `SyncEngine` methods:** `captureLocalOps`, `snapshotIfFullySynced`, `forceSnapshot`, `setLastLocalSeq`.
- **`core::SyncEngine::force_snapshot()`** (new) — unconditional prune-all snapshot for **anonymous / local-only** sessions: they never sync, so the outbox never drains and `snapshot_if_fully_synced` never fires. Fired on tab-hide. MUST NOT be called on a syncing doc.
- **`store.ts` gained `setBeforeFlush`** — `captureLocalOps()` runs *before* `engine.flush()` so the outbox-driven push ships the just-captured row (otherwise `try_start_push` sees an empty outbox and falls back to the legacy path).
- **Resume cursor stays in the `airday-web` `device` row** (`js/core/src/storage/device-store.ts`), seeded into `SyncEngine::new`'s `last_acked_seq`. This mirrors the CLI keeping the cursor in its config file rather than deriving it from the (compacted) op log. `BootState::last_acked_server_seq` is deliberately **not** used for the cursor.
- **Migration: skipped.** Per explicit direction ("flush all existing data"), `airday-engine` is a fresh DB and the old `airday-web` WAL/OPFS data is abandoned, not drained. The drain described at the end of this section was **not** built.

> ⚠️ **wasm `&[u8]` transient-view gotcha (cost a real bug, fixed):** when wasm-bindgen passes a `&[u8]` arg to a JS extern method, the `Uint8Array` is a *view into wasm linear memory* valid only for that synchronous call. `IdbStorage` retains ciphertext/nonce (mirror + deferred IDB write), so it **must copy on entry** (`copyBytes` = `.slice()`). Without the copy, the deferred write persisted reused/garbage memory → decrypt failed on the next boot → items vanished on refresh (in-session was fine, since the doc is the source of truth). The synchronous mock test did **not** catch it; only a real browser reload did. Any future JS-side `EngineStorage` impl that retains wasm-passed bytes must copy.

**Continuity note (post-Phase-1):** the engine's push path is now outbox-driven and forks on
`storage.outbox()`. The moment web swaps `NoopStorage` → `IdbStorage`, the engine starts taking
the *outbox* branch for web too — so web must feed that outbox or it'll push nothing. Mirror the
CLI: call `engine.capture_local_ops()` (commit → durable op row, advances the capture cursor) on
every local mutation, and `engine.snapshot_if_fully_synced()` to compact. The legacy
`pending_export` fallback only fires while the outbox is empty, so once `IdbStorage` is live the
web client owns capture exactly like the CLI does. Delete the legacy fallback in Phase 3, not
Phase 2 (it's the safety net during cutover).

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

The DEK seal/open round-trip (**as built** — note the boot path differs from the original sketch):
- Commit + ack are driven by the engine through the trait: `captureLocalOps()` seals via `pending_export` and calls `appendLocalOp`; `OpsAck` calls `ackLocalOp`; remote frames call `appendRemoteOp` from inside `handleServerBytes`. The host no longer manages a cursor.
- **Boot is host-driven in JS and mirrors the CLI's `boot_doc`** (NOT `Doc.load`): the snapshot payload is a *bare Loro snapshot* (`doc.snapshot_blob` = `export(Snapshot)`), not a `save()` envelope. So:
  `doc = Doc.empty()` → `doc.importWalUpdates(dek.open(snapshot))` (if any) → `doc.importWalUpdates(dek.open(row))` for each replay row in `localSeq` order → `doc.markPushed()`. `importWalUpdates` (= `import_with(_, "remote")`) accepts both snapshot- and update-mode payloads and emits no events. `markPushed()` advances `last_pushed_vv` so the engine doesn't re-capture replayed ops; unacked ops re-push from the **persisted outbox**, not `pending_export`.
  Then `new SyncEngine(doc, …, storage)` and `engine.setLastLocalSeq(bootRows.lastLocalSeq)`. For a fresh signup (or brand-new anonymous doc with an empty store) start from `Doc.create()` and `captureLocalOps()` the seed; for an authed device with an empty store start `Doc.empty()` and let sync deliver a snapshot.

The existing `airday-web` IDB database (vault + prefs + the now-defunct WAL/OPFS/device stores) stays untouched in this phase. The new `airday-engine` database is fresh. **No migration/drain was built — abandoning old `airday-web` op data was explicitly authorized.** (Original plan called for a one-shot drain from the spike's `worker/migration.ts`; intentionally skipped.)

**Exit criteria:** web builds, anonymous + authed sessions work end-to-end, reload survives, multi-tab works as it does today (single tab via `navigator.locks` — *not* trying to be multi-tab-coherent, that's a separate effort).

### Phase 3 — Cleanup *(done)*

**What landed (read before re-deriving):**

- **`NoopStorage` + legacy `pending_export` fallback deleted.** `storage` is mandatory everywhere: native `SyncEngine::new` already took `DynStorage`; the wasm 7th arg is now a required `EngineStorage` (not `Option`). `try_start_push` ships the outbox unconditionally; `OpsAck` always acks by `client_op_id`; `in_flight_push_vv` and its OpsAck branch are gone.
- **`Doc::pending_export` / `mark_pushed_at` / `mark_pushed` / `last_pushed_vv` were KEPT** — the caveat below was decisive. They're not legacy; they're the live **capture cursor** the outbox path depends on (`capture_local_ops` exports the delta via `pending_export` and advances the cursor via `mark_pushed_at`; web boot calls `markPushed()` after replay). Deleting them would mean redesigning the capture-cursor model, which is out of scope for cleanup. Only the genuinely-dead legacy push code was removed.
- **Rust test fallout:** seven `sync.rs` legacy-auto-push tests now call `eng.capture_local_ops()` before the flush/pull-complete/ack that drives the push (the seed-pushing multi-engine tests capture the seed right after construction). All green.
- **JS test fallout:** `MemEngineStorage` promoted to a shared helper `js/core/test/mem-engine-storage.ts`, threaded into `sync-engine.test.ts`, `sync-e2e.test.ts` (which also gained `captureLocalOps()` in its push loop), and `js/web/test/search.test.ts`. `wal-ack-gate.test.ts` + `wal-storage.test.ts` were **deleted** (their durability invariants are covered by `core/src/sync.rs`).
  - ⚠️ **The shared `MemEngineStorage` MUST copy wasm-passed bytes on entry** (`.slice()`), exactly like the real `IdbStorage`. The first cut didn't, and the e2e failed with a decrypt error on the peer — the retained `ciphertext`/`nonce` were transient views into wasm linear memory, reused by the time the outbox shipped them after the async server round-trip. (Same gotcha the Phase 2 note flags for `IdbStorage`.)
- **Legacy JS WAL + OPFS files deleted:** `idb-wal.ts`, `wal-adapter.ts`, `mem-wal.ts`, `wal-bridge.ts`, `opfs-probe.ts`, plus their `index.ts` + `package.json` exports.
- **`web-db.ts`:** bumped to **v7**; `ops` + `snapshot_meta` stores dropped on upgrade (deleted if present, data abandoned). Surviving: `vault`, `device`, `prefs`. The v1–v6 branch ladder collapsed to idempotent create-if-missing.
- **`App.tsx` boot now hard-fails when IndexedDB can't be opened** (decided this phase): there's no storage-less engine, so a failed `IdbStorage.open` / doc-rebuild surfaces a "Failed to start" screen instead of booting on `null` storage. `BootInfo.storage` is non-null; the `if (!storage)` guards and the dead `bootError` MainApp prop are gone. Removed the `__airday` debug handle and the `console.debug` mount line (kept the boot-failure `console.error`).
- **`forceSnapshot`** left as-is (fired on `visibilitychange → hidden`) — low priority per the note below; anonymous docs are small/short-lived.
- **`notify_wal_durable`** kept as the IDB flush signal, as decided in Phase 2.
- `spec/idb-wal.md` dropped; `spec/architecture.md` gained a "Local persistence" section pointing at the trait.

---

_Original Phase 3 checklist (kept for provenance):_

Phase 2 is verified in real use (anonymous + authed add → reload → restore, both confirmed in a real browser). Remaining cleanup, with the **test fallout** each item triggers — that fallout is the bulk of the work, not the deletions:

- **Delete `core::NoopStorage` + the legacy `pending_export` push fallback.** These are coupled: today `SyncEngine::new`'s `storage: None` branch builds `NoopStorage`, and `try_start_push` falls back to `pending_export` when `storage.outbox()` is empty. Removing them means **`storage` becomes mandatory** on the wasm + native constructors. Fallout:
  - The wasm `SyncEngine::new` 7th-arg `Option<EngineStorage>` becomes required (or keep optional but error on `None`).
  - js/core + js/web tests construct the engine with **6 args** (no storage) and rely on the legacy path: `js/core/test/sync-engine.test.ts`, `sync-e2e.test.ts`, `wal-ack-gate.test.ts`, `wal-storage.test.ts`, `js/web/test/search.test.ts`. These must pass a real/mem `EngineStorage`. The pattern is already in `js/core/test/engine-storage.test.ts` (`MemEngineStorage` mock) — promote it to a shared test helper and thread it through.
- **Delete `Doc::pending_export`, `Doc::mark_pushed_at`, `Doc::last_pushed_vv`** from `core/src/doc.rs`. Caveat: web **boot** currently calls `doc.markPushed()` to advance `last_pushed_vv` after replay (so the engine doesn't re-capture replayed ops). If `last_pushed_vv` goes away, boot needs an equivalent "these ops are already captured" signal, or the capture-cursor model must change. Don't delete blindly — trace `markPushed`/`mark_pushed_at` in `core/web/src/lib.rs` + `js/web/src/App.tsx` boot first.
- **Durability callback — decision made in Phase 2: keep `notify_wal_durable` as the IDB flush signal.** `IdbStorage.whenFlushed()` → `engine.notifyWalDurable(sampledSeq)` in `App.tsx`. sqlite is synchronously durable so the CLI calls it inline. No need to fold into the trait; leave as-is unless it gets in the way.
- **Delete the legacy JS WAL files:** `js/core/src/storage/idb-wal.ts`, `wal-adapter.ts`, `mem-wal.ts`, `wal-bridge.ts`, and their exports in `js/core/src/index.ts` + `js/core/package.json`. `wal-ack-gate.test.ts` + `wal-storage.test.ts` are built entirely on `WalBridge`/`MemWalStorage` — they must be rewritten against `IdbStorage`/`MemEngineStorage` or deleted (the engine-level durability invariants they assert are also covered by the Rust tests in `core/src/sync.rs`).
- **Delete the OPFS-snapshot code path** (`opfs-probe.ts` and OPFS reads/writes in the old `idb-wal.ts`). Snapshots now live in the `airday-engine` `snapshots` store. `probeOpfs` is no longer imported by `App.tsx`.
- **`web-db.ts` (`airday-web`):** the `ops` + `snapshot_meta` stores are now dead (engine data moved to `airday-engine`). Surviving stores: `vault`, `prefs`, and `device` (the resume cursor — see `device-store.ts`; keep it here or fold into `airday-engine`). Collapse the v1–v6 upgrade branches accordingly.
- Drop `spec/idb-wal.md` (superseded by this plan).
- Update `spec/architecture.md` to point at the trait.
- **Decide on `forceSnapshot` for anonymous compaction.** Currently fired only on `visibilitychange → hidden` (`App.tsx`). If that's too coarse (long-lived anonymous tab never hidden → unbounded op log), consider a count-based trigger. Low priority — anonymous docs are small and short-lived pre-signup.
- Remove the dev-only `(window as any).__airday = { app, engine, bridge, storage }` debug handle and the boot `console.error`/`console.debug` lines in `App.tsx` if not wanted (the boot-failure `console.error` is arguably worth keeping).

## Verification

- All existing `cargo test`s pass.
- All existing `bun test` suites pass (especially `js/web/test/search.test.ts` which feeds `AppEvent`s through the dispatcher — the trait shouldn't affect that path).
- Manual: sign up, add items, switch lists, edit, undo, reload, log out, log back in — every flow survives.
- Sync: two devices (CLI + web, or two CLI instances) converge through the server.
- ~~Migration: drain a real `airday-web` IDB + OPFS profile into the new schema.~~ **Cut** — flushing old data was authorized; `airday-engine` is fresh and old data is abandoned.

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
