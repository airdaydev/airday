# Local Storage

Per-account local persistence for the doc — the **same logical model on every client**, behind one Rust trait (`core::LocalStorage`, `core/src/storage.rs`). Encrypted-at-rest op rows are the hot path; occasional encrypted snapshot rows are the cheap-replay base. The substrate differs by platform — **CLI: sqlite on disk; web: IndexedDB on the main thread** — but the schema, boot semantics, and snapshot policy are identical (the engine only ever sees the trait).

## Thesis

The local store mirrors the server's storage shape: append-only encrypted op blobs plus periodic encrypted snapshots, keyed by `doc_id`. The two differences from the server schema are:

1. Local rows carry a client-minted `client_op_id` so the server can dedupe retries and so the client can map acks back to rows.
2. Each row carries a `server_seq` that is `NULL` until the server acks the upload. `server_seq IS NULL` is the outbox.

A oplog row is *the* unit. It is what Loro exported, what gets encrypted at rest, what gets sent on the wire, what the server stores under its own seq, what gets ack-mapped, and what gets replayed on boot. There is no separate "upload parcel" abstraction.

## Storage substrate

Per account, one sqlite database.

- **CLI**: `SqliteStorage` (`cli/src/storage.rs`) — a file on disk under the profile dir. Same pragmas as the server (`spec/storage.md` §Sqlite settings). Writes are synchronously durable: the trait method returns only after the `INSERT` commits.
- **Web**: `IdbStorage` (`js/core/src/storage/idb-storage.ts`) — IndexedDB on the **main thread**, behind a wasm-bindgen `EngineStorage` extern (`core/web/src/lib.rs`). No Worker, no OPFS, no sqlite-wasm. The trait is synchronous but IDB is async, so `IdbStorage` keeps a synchronous in-memory mirror of the op log that the extern methods read/write immediately and flushes the real IDB transaction on a background promise chain; durability is signalled back out-of-band (`whenFlushed()` → the host's `notify_oplog_durable`) so an `Ack` isn't shipped until the bytes are on disk. IndexedDB is **hard-required** — a session that can't open it surfaces a "Failed to start" screen rather than booting on a storage-less engine.

The engine sees a single `LocalStorage` trait; the CLI binds a native sqlite handle, the web binds the IDB-backed extern. Storage is mandatory — there is no storage-less engine mode.

## Schema

```sql
CREATE TABLE docs (
  id                    BLOB PRIMARY KEY,          -- uuid v7, matches server-side docs.id
  created_at            INTEGER NOT NULL,
  last_acked_server_seq INTEGER NOT NULL DEFAULT 0, -- per-doc pull cursor; persisted, not derived (survives compaction)
  last_sync_at          INTEGER                    -- unix millis of last successful ONLINE sync; NULL = never (not bumped by offline/local flushes)
);

CREATE TABLE ops (
  doc_id          BLOB    NOT NULL REFERENCES docs(id),
  local_seq       INTEGER NOT NULL,               -- client-minted, dense, gap-free per doc
  client_op_id    BLOB,                           -- uuid v7; NOT NULL for local rows, NULL for server-originated
  server_seq      INTEGER,                        -- NULL until server acks (local rows); set on insert for remote
  payload         BLOB    NOT NULL,               -- encrypted Loro update bytes (DEK)
  payload_nonce   BLOB    NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (doc_id, local_seq)
);
CREATE UNIQUE INDEX ops_client_op_id_idx ON ops (doc_id, client_op_id) WHERE client_op_id IS NOT NULL;
CREATE UNIQUE INDEX ops_server_seq_idx   ON ops (doc_id, server_seq)   WHERE server_seq   IS NOT NULL;

CREATE TABLE snapshots (
  doc_id            BLOB    NOT NULL PRIMARY KEY REFERENCES docs(id),
  up_to_local_seq   INTEGER NOT NULL,             -- effects of ops with local_seq <= this are included
  payload           BLOB    NOT NULL,             -- encrypted Loro snapshot bytes (DEK)
  payload_nonce     BLOB    NOT NULL,
  created_at        INTEGER NOT NULL
);

-- CLI-only: singleton (id pinned to 1) account/device identity. Not part
-- of the shared doc-storage model — web holds identity elsewhere — but it
-- lives in the same db on the CLI so identity and the doc cache share one
-- transactional store. See spec/cli.md "Local state".
CREATE TABLE account (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  account_id     TEXT NOT NULL,
  email          TEXT NOT NULL,
  device_id      TEXT NOT NULL,
  primary_doc_id BLOB NOT NULL                    -- uuid bytes; matches docs.id
);
```

Notes:

- `local_seq` is the **only** ordering authority for replay. It increases monotonically as rows are appended, regardless of origin (local vs remote). The composite `(doc_id, local_seq)` PK doubles as the replay index.
- `client_op_id` is the idempotency key on the wire. Server keeps a recent-ids dedupe window so a retried upload after a crash maps to the existing server-side row instead of creating a duplicate.
- `server_seq` here is **the same `seq`** that the server's `ops` table assigns. On the local row it is `NULL` until the corresponding ack arrives.
- One snapshot row per doc — `INSERT OR REPLACE` on each new snapshot. There's no need for the M=2 retention the server uses (no concurrent bootstrap reader to protect).
- `docs.last_acked_server_seq` is the **persisted** pull cursor — the highest `server_seq` applied. It is *not* derived from `MAX(ops.server_seq)`, which would underestimate once compaction prunes the acked ops it was read from.

## Origin invariants

Two row shapes, distinguished by which nullable columns are set:

| Origin   | `client_op_id` | `server_seq`        | When written                         |
|----------|----------------|---------------------|--------------------------------------|
| local    | set            | `NULL` until acked  | engine commits a local mutation      |
| remote   | `NULL`         | set at insert       | server frame applied to local doc    |

A row never changes origin. The only mutation after insert is `UPDATE ops SET server_seq = ? WHERE doc_id = ? AND client_op_id = ?` on ack.

## Append path

Local mutation:

1. Engine commits → Loro produces a delta blob covering the new ops.
2. Encrypt the blob with the DEK → `(payload, payload_nonce)`.
3. Mint `client_op_id = uuid_v7()`.
4. `INSERT INTO ops (doc_id, local_seq, client_op_id, server_seq=NULL, payload, payload_nonce, created_at)` with `local_seq = MAX(local_seq)+1` for this doc (computed inside the same transaction).
5. Treat the mutation as locally durable. Hand the encrypted bytes + `client_op_id` to the WS layer for push.

Remote frame:

1. Decrypt and apply the frame to the live Loro doc (this is what the engine does today regardless of persistence).
2. `INSERT INTO ops (doc_id, local_seq, client_op_id=NULL, server_seq, payload, payload_nonce, created_at)` — the encrypted bytes are the ones the server sent, stored verbatim. This insert does **not** touch the pull cursor.
3. Separately, when the host signals durability (`SyncEngine::notify_oplog_durable`) the engine advances its in-memory contiguous/durable frontier and persists the new value through `LocalStorage::write_acked_seq(doc_id, seq)` → `docs.last_acked_server_seq`. The engine is the sole authority: it passes the *contiguous* frontier (an out-of-order op above a gap does not move it), so storage never derives the cursor itself (see `spec/sync-protocol.md`).

Wire batching is a separate concern: the WS layer **may** pack multiple rows into one frame for throughput. Each row keeps its own `client_op_id` and gets its own `server_seq` in the ack. The storage layer does not know about batching.

## Replay / boot

Per doc, in a single transaction:

1. Read the snapshot row (if any). Decrypt → seed Loro doc.
2. `SELECT payload, payload_nonce FROM ops WHERE doc_id = ? AND local_seq > snapshot.up_to_local_seq ORDER BY local_seq` — decrypt each and apply to the Loro doc in order.

That's the entire boot. The same path covers:

- **Fresh account** — no snapshot row, ops table may be empty (signup-seeded built-ins arrive as the first appends).
- **Pure-oplog recovery** — no snapshot yet, replay all ops.
- **Snapshot + tail** — the common steady-state case.

Pending rows (those with `server_seq IS NULL`) are skipped only if their `local_seq ≤ snapshot.up_to_local_seq` — their effects are already in the snapshot. They remain on disk for re-upload; see Outbox.

## Outbox

```sql
SELECT doc_id, client_op_id, payload, payload_nonce
FROM ops
WHERE server_seq IS NULL
ORDER BY local_seq;
```

On every reconnect, the WS layer drains the outbox and pushes the rows verbatim. Ack handling:

```sql
UPDATE ops SET server_seq = ? WHERE doc_id = ? AND client_op_id = ?;
```

`client_op_id` is unique per doc (enforced by the partial index), so the mapping is unambiguous. If the server re-issues an ack for a row already acked locally (network reorder), the UPDATE is a no-op — `server_seq` only ever transitions `NULL → set`, never the reverse.

## Snapshot policy

A snapshot is triggered when **either**:

- `COUNT(ops) - snapshot.up_to_local_seq ≥ N` (default `N = 1000`), or
- approximate encrypted-bytes-since-snapshot ≥ `B` (default `B = 5 MiB`).

Snapshot procedure (one sqlite transaction):

1. Export the current Loro state for this doc.
2. Encrypt → `(payload, payload_nonce)`.
3. Sample `up_to = MAX(local_seq) FROM ops WHERE doc_id = ?` — the cutoff for what's reflected.
4. `INSERT OR REPLACE INTO snapshots (doc_id, up_to_local_seq=up_to, payload, payload_nonce, created_at)`.
5. `DELETE FROM ops WHERE doc_id = ? AND server_seq IS NOT NULL AND local_seq ≤ up_to`. **Pending rows survive.**
6. Commit.

Atomicity is sqlite's job; no double-buffering needed. Either the new snapshot + truncated ops are visible together or neither is.

## Compaction

There is no separate compaction job. Step 5 of the snapshot procedure is the compaction. Run cadence: snapshot is fired by the engine (or its persistence bridge) when a write trips the threshold above; it is not synchronous with each commit.

Pending rows (`server_seq IS NULL`) are never compacted. An offline client accumulates them in the outbox indefinitely; on reconnect they all upload. This matches the server-side reality that the doc's history cannot be compacted past the slowest device's frontier.

## Failure semantics

- **Crash during local append**: the row is either fully committed in sqlite or not — sqlite transaction guarantees. No torn rows.
- **Crash between append and send**: row exists with `server_seq IS NULL`. On boot, outbox drain re-sends it. Server dedupes by `client_op_id`.
- **Crash between send and ack**: row exists with `server_seq IS NULL`; server may already have it. On boot, outbox drain re-sends; server's recent-ids window maps the retry to the existing server row and returns the original `server_seq` in the ack.
- **Crash during remote-frame apply**: the row is either fully inserted with its `server_seq` or not — sqlite transaction guarantees. The `docs.last_acked_server_seq` cursor is persisted by a *separate* write (`write_acked_seq`, driven by the engine on `notify_oplog_durable` after the op rows are durable), so a crash after the op insert but before the cursor advance leaves the cursor *behind* the stored ops — never ahead. This self-heals: on reboot the engine re-pulls from the lower cursor and `append_remote_op` dedupes the already-stored `server_seq` rows. The two writes are deliberately *not* one transaction: the cursor value is the engine's contiguous frontier (unknown at op-insert time, since out-of-order ops above a gap mustn't advance it), and the durability seam (`notify_oplog_durable`) is what lets the sync engine straddle synchronous sqlite and async IDB.
- **Crash during snapshot**: the snapshot + the ops DELETE are one transaction; either both land or neither. Pre-snapshot ops survive in full if the transaction aborted, so replay still works from the previous snapshot row (or pure-oplog if there wasn't one).

## Design constraints

- Local rows are encrypted at rest with the DEK. The local DB file is not a security boundary on its own — it matches the at-rest posture of the server's `ops` table.
- The engine never sees `client_op_id` or `server_seq`. They live entirely between the storage layer and the WS layer.
- Op blobs in the local DB are byte-for-byte the same as what's on the wire and what's stored on the server. No re-encryption, no re-encoding on resend.
- The wire ack format must carry `{client_op_id → server_seq}` per acknowledged op. The exact frame layout is specified in `spec/sync-protocol.md`.

## Why IDB on web (not sqlite / Worker / OPFS)

An earlier spike (`spike/shared-worker`) ran sqlite-wasm on the OPFS-SAH-pool VFS inside a SharedWorker, with the engine off the main thread. It worked end-to-end and was abandoned. The reasons are durable design constraints, not incidental:

1. **`createSyncAccessHandle` is `DedicatedWorkerGlobalScope`-only by spec** — not a vendor bug. A SharedWorker therefore *cannot* host OPFS-backed sqlite in any browser. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle), [wa-sqlite #79](https://github.com/rhashimoto/wa-sqlite/discussions/79)). Don't propose this combination again.
2. **sqlite-wasm buys nothing here.** We store opaque encrypted blobs, not queryable data, so we never use SQL's query power — but we'd pay ~1 MB of bundle plus the COOP/COEP header requirement. IDB is exactly the right shape (ordered keyed store with transactions) and ships in every browser for free.
3. **The engine must stay on the main thread.** Moving it into a Worker adds a postMessage round-trip to every mutation; the lag is perceptible in tight UI loops (typing, drag-reorder). Multi-tab coherence and Argon2id-off-main are real wins but not worth that regression.
4. **The trait is the prize, not a unified storage technology.** "Same Rust engine, same boot semantics, same op log, same snapshot policy" is the value. sqlite on one side and IDB on the other satisfy it identically — the engine never knows which.

### Web boot + the bytes-copy gotcha

Web boot is **host-driven in JS** and mirrors the CLI's `boot_doc` (it does *not* use `Doc.load`): `Doc.empty()` → replay the decrypted snapshot (a bare Loro snapshot, not a `save()` envelope) and every tail row in `local_seq` order through `replayOplogUpdate` → call `finishOplogReplay()` once to build disposable indexes and clear historical events → `markPushed()` so the engine doesn't re-capture replayed ops. Rebuilding after every row is forbidden: with N items and R replay rows it turns refresh into O(N×R). The resume cursor comes from `IdbStorage.bootRows().lastAckedSeq` — the engine-persisted `docs.lastAckedServerSeq` in the engine stores of the `airday-web` DB (written via `writeAckedSeq`), **not** the `device` row (which now holds only identity + the `lastSyncAt` observability stamp) and **not** derived from the compacted op log.

Initial attachment is not a live mutation stream and does not trigger compaction. The web store materializes once from `workspaceSnapshotJson`; live bulk/opaque changes emit one `FullResync` control event and use the same one-shot materialization path. Search indexing follows materialization. Normal snapshot compaction is gated on the sync engine reaching steady-state `Idle`.

⚠️ Any JS-side `EngineStorage` impl that **retains** wasm-passed `&[u8]` bytes must copy them on entry (`.slice()`). wasm-bindgen hands `&[u8]` as a `Uint8Array` view into wasm linear memory valid only for that synchronous call; `IdbStorage` defers the IDB write, so without a copy it persists reused/garbage memory and the next boot fails to decrypt. This cost a real bug and is invisible to synchronous mock tests — only a real browser reload catches it. (`idb-storage.ts` documents this inline; `roadmap.md` tracks a proposal to enforce the copy Rust-side.)

## Migration

Pre-release: **no data was migrated from the old layouts** — both clients start fresh under this schema. This is deliberate (pre-release, single-user, no production data to preserve) and is the standing migration rule (see `AGENTS.md`).

- **CLI**: the schema ships as a single migration file (`cli/migrations/001_init.sql`); there is no incremental migration and no legacy-bridge table. The old single-row `docs(payload)` blob is not drained.
- **Web**: the engine op log lives in the `docs` / `ops` / `snapshots` stores of the single `airday-web` IDB database, alongside the config stores (`vault` / `device` / `prefs`). The old oplog/OPFS op data was abandoned, not drained; the v8 `web-db.ts` upgrade drops the dead pre-v7 `ops` / `snapshot_meta` stores (re-creating `ops` with the engine schema) and best-effort deletes the short-lived separate `airday-engine` database from the v7 era.

## Testing

Required cases:

1. Fresh account boots with no snapshot row and an empty ops table.
2. Pure-ops replay restores state before the first snapshot exists.
3. Snapshot + trailing ops replay restores state correctly post-snapshot.
4. Crash mid-append leaves no partial row; outbox drain re-sends on reconnect.
5. Crash between send and ack: re-send maps to original `server_seq` via dedupe, ack updates the row.
6. Multiple snapshot cycles preserve replay correctness; pending rows survive across snapshots and remain in the outbox.
7. Re-upload after the WS layer drops mid-frame works without producing duplicate server rows.
8. Local snapshot + tail hydration builds indexes once and emits no live events.
9. A server bootstrap snapshot is written as the local cutoff-zero baseline before its server frontier can be acknowledged; refresh replays that baseline plus every existing local row.

## Out of scope

- **Multi-tab coherence on web.** One engine, one tab; the `navigator.locks` single-tab gate stays. Making tabs coherent is a separate effort.
- **Engine in a Worker.** Stays on the main thread — see *Why IDB on web* §3.
- **Argon2id off the main thread.** It blocks the UI for ~hundreds of ms on login. Acceptable for now; solvable later with a dedicated Worker *just* for the KDF, without disturbing the engine.
- **sqlite on web.** Not happening unless the OPFS-SAH spec changes — see *Why IDB on web* §1.

## Open questions

- Exact dedupe-window TTL on the server side (minutes? hours?). Trade-off: longer window costs server memory but tolerates longer client gaps between send-attempt and retry.
- Whether to expose a `VACUUM`-style maintenance step for the local DB after large compactions (sqlite's auto_vacuum may suffice; needs measurement).
- Migration ordering when the wire ack format itself changes — assumed to land in lockstep with this spec, but the CLI may briefly run against an older server during a self-hosted upgrade. Out of scope for v1 (`spec/saas.md` covers the broader self-hosted upgrade story).
