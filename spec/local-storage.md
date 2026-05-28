# Local Storage

Per-account local persistence for the doc — same model on every client. Sqlite as the substrate, encrypted-at-rest op rows as the hot path, occasional encrypted snapshot rows as cheap-replay base. Supersedes `spec/idb-wal.md` and `cli/migrations/001_init.sql`'s single-row docs table.

## Thesis

The local store mirrors the server's storage shape: append-only encrypted op blobs plus periodic encrypted snapshots, keyed by `doc_id`. The two differences from the server schema are:

1. Local rows carry a client-minted `client_op_id` so the server can dedupe retries and so the client can map acks back to rows.
2. Each row carries a `server_seq` that is `NULL` until the server acks the upload. `server_seq IS NULL` is the outbox.

A WAL row is *the* unit. It is what Loro exported, what gets encrypted at rest, what gets sent on the wire, what the server stores under its own seq, what gets ack-mapped, and what gets replayed on boot. There is no separate "upload parcel" abstraction.

## What this supersedes

- The prior OPFS-snapshot + IDB-WAL split (previously specified in `spec/idb-wal.md`, now removed) is replaced by a single sqlite DB per account.
- `cli/migrations/001_init.sql` — the single-row `docs(payload BLOB)` table is replaced by the schema below.

## Storage substrate

Per account, one sqlite database.

- **CLI**: file on disk under the profile dir (`<profile>/airday.db`). Same pragmas as the server (`spec/storage.md` §Sqlite settings).
- **Web**: sqlite-wasm running inside a dedicated Worker, backed by the OPFS-SAH-pool VFS. The main thread talks to the Worker over postMessage. OPFS is **hard-required**; sessions without OPFS (older browsers, some private-window modes) fall back to an in-memory store that does not survive reload. The previous IDB-only fallback for anonymous sessions is dropped.

Same schema, same migrations, same code path (the engine sees a single `Storage` trait — the CLI binds to a native sqlite handle, the web binds to a thin wrapper that proxies SQL to the Worker).

## Schema

```sql
CREATE TABLE docs (
  id           BLOB PRIMARY KEY,                  -- uuid v7, matches server-side docs.id
  created_at   INTEGER NOT NULL
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
```

Notes:

- `local_seq` is the **only** ordering authority for replay. It increases monotonically as rows are appended, regardless of origin (local vs remote). The composite `(doc_id, local_seq)` PK doubles as the replay index.
- `client_op_id` is the idempotency key on the wire. Server keeps a recent-ids dedupe window so a retried upload after a crash maps to the existing server-side row instead of creating a duplicate.
- `server_seq` here is **the same `seq`** that the server's `ops` table assigns. On the local row it is `NULL` until the corresponding ack arrives.
- One snapshot row per doc — `INSERT OR REPLACE` on each new snapshot. There's no need for the M=2 retention the server uses (no concurrent bootstrap reader to protect).

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
2. `INSERT INTO ops (doc_id, local_seq, client_op_id=NULL, server_seq, payload, payload_nonce, created_at)` — the encrypted bytes are the ones the server sent, stored verbatim.
3. Advance `last_acked_seq` on the device row once the contiguous-prefix invariant allows it (see `spec/sync-protocol.md`).

Wire batching is a separate concern: the WS layer **may** pack multiple rows into one frame for throughput. Each row keeps its own `client_op_id` and gets its own `server_seq` in the ack. The storage layer does not know about batching.

## Replay / boot

Per doc, in a single transaction:

1. Read the snapshot row (if any). Decrypt → seed Loro doc.
2. `SELECT payload, payload_nonce FROM ops WHERE doc_id = ? AND local_seq > snapshot.up_to_local_seq ORDER BY local_seq` — decrypt each and apply to the Loro doc in order.

That's the entire boot. The same path covers:

- **Fresh account** — no snapshot row, ops table may be empty (signup-seeded built-ins arrive as the first appends).
- **Pure-WAL recovery** — no snapshot yet, replay all ops.
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
- **Crash during remote-frame apply**: the row is either fully inserted with its `server_seq` or not — sqlite transaction guarantees. The engine's `last_acked_seq` advance happens in the same transaction, so the contiguous-prefix invariant holds.
- **Crash during snapshot**: the snapshot + the ops DELETE are one transaction; either both land or neither. Pre-snapshot ops survive in full if the transaction aborted, so replay still works from the previous snapshot row (or pure-WAL if there wasn't one).

## Design constraints

- Local rows are encrypted at rest with the DEK. The local DB file is not a security boundary on its own — it matches the at-rest posture of the server's `ops` table.
- The engine never sees `client_op_id` or `server_seq`. They live entirely between the storage layer and the WS layer.
- Op blobs in the local DB are byte-for-byte the same as what's on the wire and what's stored on the server. No re-encryption, no re-encoding on resend.
- The wire ack format must carry `{client_op_id → server_seq}` per acknowledged op. The exact frame layout is specified in `spec/sync-protocol.md`.

## Migration

- **CLI**: existing `docs(doc_id, payload, updated_at)` rows are read once at boot, decoded as Loro snapshots, re-encrypted with the DEK, and inserted into the new `snapshots` table; the old table is then dropped. The migration runs inside the standard `_migrations` machinery as `002_local_storage`.
- **Web**: IDB `ops` rows are drained, re-encoded as `ops` table rows under matching `local_seq` values; the OPFS `loro.bin` is read and inserted into the `snapshots` table; the `airday-web` IDB database and the OPFS snapshot file are deleted after the transaction commits. Run-once at the first boot under the new schema; idempotent on subsequent runs.

## Testing

Required cases:

1. Fresh account boots with no snapshot row and an empty ops table.
2. Pure-ops replay restores state before the first snapshot exists.
3. Snapshot + trailing ops replay restores state correctly post-snapshot.
4. Crash mid-append leaves no partial row; outbox drain re-sends on reconnect.
5. Crash between send and ack: re-send maps to original `server_seq` via dedupe, ack updates the row.
6. Multiple snapshot cycles preserve replay correctness; pending rows survive across snapshots and remain in the outbox.
7. Re-upload after the WS layer drops mid-frame works without producing duplicate server rows.

## Open questions

- Exact dedupe-window TTL on the server side (minutes? hours?). Trade-off: longer window costs server memory but tolerates longer client gaps between send-attempt and retry.
- Whether to expose a `VACUUM`-style maintenance step for the local DB after large compactions (sqlite's auto_vacuum may suffice; needs measurement).
- Migration ordering when the wire ack format itself changes — assumed to land in lockstep with this spec, but the CLI may briefly run against an older server during a self-hosted upgrade. Out of scope for v1 (`spec/saas.md` covers the broader self-hosted upgrade story).
