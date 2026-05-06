# Local Snapshot + IndexedDB WAL

This spec is about local browser persistence only.

It does **not** define multi-tab behavior, websocket ownership, sync election, or cross-tab coordination. The problem here is narrower:

- local mutations must become durable immediately
- periodic full-state persistence should remain cheap to load
- closing a tab before the next full snapshot write must not lose recent local work

## Thesis

Use two local persistence layers:

- **OPFS** for the latest full local snapshot
- **IndexedDB** for the hot write-ahead log (WAL)

Local restore is:

```text
current state = latest OPFS snapshot + IndexedDB WAL entries after that snapshot
```

That is the core invariant.

## Goals

- make every local committed mutation durable immediately
- keep restore fast by loading a full snapshot first
- avoid treating full snapshot writes as the hot path
- use a safer substrate for per-mutation durable writes than a hand-rolled file WAL
- keep the storage model replayable by the engine

## Non-Goals

This spec does not define:

- multi-tab rules
- local write arbitration between tabs
- safe WAL pruning horizons beyond local replay correctness
- undo/redo stack persistence
- any new snapshot format

## Storage Layout

Per account:

- OPFS:
  - `loro.bin` — the latest committed full snapshot
- IndexedDB:
  - `ops` store — durable WAL records
  - `snapshot_meta` store — committed snapshot metadata

## OPFS Snapshot

The OPFS snapshot is the existing canonical engine snapshot blob.

Rules:

- reuse the current snapshot encoding
- encrypt snapshot bytes at rest with the account DEK
- treat `loro.bin` as the latest committed base state for restore

No second snapshot format is introduced.

## IndexedDB WAL

IndexedDB stores the hot WAL.

Rules:

- each committed local mutation must be durably appended to the WAL before it is considered locally durable
- WAL payloads must be encrypted at rest with the account DEK
- WAL records must represent canonical replayable engine input, not projected UI patches
- WAL ordering must be explicit

Initial implementation choice:

- one IndexedDB row per op
- no batching at the storage layer

IndexedDB database layout:

- database name: `airday-local`
- object store: `ops`
- primary key: `["account_id", "wal_seq"]`
- index: `"by_account_seq"` on `["account_id", "wal_seq"]`
- object store: `snapshot_meta`
- primary key: `account_id`

No additional indexes are required in the first implementation.

At minimum, every WAL record contains:

- `account_id`
- `wal_seq`
- `nonce`
- `ciphertext`
- `created_at`

The encrypted payload must decrypt to canonical op bytes or equivalent replayable engine input.

`wal_seq` is a monotonic per-account local sequence assigned by the local persistence layer.

## Metadata

Committed snapshot metadata lives in the IndexedDB `snapshot_meta` store.

At minimum:

- `version`
- `account_id`
- `snapshot_file`
- `snapshot_wal_seq`
- `snapshot_bytes`
- `snapshot_sha256`
- `committed_at`

Where:

- `snapshot_file` is the committed snapshot file name, initially `loro.bin`
- `snapshot_wal_seq` is the highest WAL sequence whose effects are included in the committed snapshot
- `snapshot_bytes` is the committed snapshot file size in bytes
- `snapshot_sha256` is the SHA-256 of the committed encrypted snapshot bytes

These extra fields exist for corruption detection and recovery sanity checks. They are part of the initial format, not an optional future addition.

## Replay Contract

Boot or restore works as follows:

1. read committed snapshot metadata from `snapshot_meta`
2. load `snapshot_file`
3. read IndexedDB WAL records with `wal_seq > snapshot_wal_seq`
4. replay them in `wal_seq` order

If that does not reproduce the same document state that existed before shutdown, the storage design is wrong.

## Fresh Account

A fresh account may start with:

- no snapshot
- no snapshot metadata
- empty WAL

Before the first snapshot exists, restore is pure WAL replay.

## Write Path

The normal local persistence path is:

1. local mutation produces canonical replayable op bytes
2. append encrypted WAL record with the next `wal_seq` into IndexedDB
3. treat the mutation as locally durable
4. periodically write a fresh full snapshot to OPFS

The WAL is the hot path. The snapshot is not.

## Snapshotting

After `1000` WAL records have been appended since the last committed snapshot, write a fresh full snapshot.

Snapshot algorithm:

1. load current state from the live runtime, or from snapshot plus WAL tail
2. write a fresh encrypted snapshot to a temporary target in OPFS
3. close the temporary file successfully
4. delete any stale prior temporary file for this account
5. replace the committed snapshot file by moving the temporary file into the committed path if supported; otherwise keep the committed file path unchanged and point metadata at the newly written snapshot file
6. atomically commit new snapshot metadata in `snapshot_meta` with the new `snapshot_wal_seq`, `snapshot_file`, `snapshot_bytes`, and `snapshot_sha256`

The first implementation does **not** require deleting old WAL records.

## Atomicity Rule

Snapshotting must never leave storage in a state where neither the old snapshot nor the new snapshot is valid.

So the commit order is:

1. write the new snapshot bytes successfully
2. make the new committed snapshot file available at the file path named by the next metadata
3. commit updated metadata

Any future WAL cleanup must happen strictly after step 3 and is not part of this spec.

The `snapshot_meta` record is the authoritative commit point. A snapshot file that exists on disk but is not referenced by committed metadata is uncommitted and must be ignored on boot.

## WAL Retention

WAL records are retained conservatively in the initial implementation.

This spec does **not** require deleting WAL records after snapshotting.

Reason:

- snapshot creation is clearly safe
- WAL deletion may not be safe until the full local-first and sync durability contract is specified

If WAL deletion is introduced later, it must be specified separately with an explicit safety rule.

The eventual safety rule is:

- a WAL record is deletable only if both:
  - its effects are covered by the committed snapshot (`wal_seq <= snapshot_wal_seq`), and
  - it is no longer needed for local-first sync recovery/resend correctness

The second clause requires a future sync-discharge frontier that is not part of the first implementation. Therefore WAL deletion is forbidden in v1.

## Failure Handling

### Crash during WAL append

Recovery relies on:

- the last successfully committed WAL record set in IndexedDB
- the last committed snapshot
- the last committed metadata

IndexedDB is the WAL substrate specifically so we do not have to invent our own torn-tail file parsing rules for the hot path.

### Crash during snapshot write

If the new snapshot or new metadata was not committed, recovery continues from the previous committed snapshot plus the WAL tail.

### Missing snapshot

If no snapshot exists yet, recovery is pure WAL replay.

That is expected early in an account's life.

## Design Constraints

- Do not store projected UI diffs in the WAL.
- Do not store plaintext op payloads in IndexedDB.
- Do not make full snapshot writes part of the per-op hot path.
- Keep snapshot and WAL payloads encrypted at rest with the DEK.
- Keep the representation replayable by the engine.
- Do not delete WAL records in the first implementation.

## Testing

Required cases:

1. Fresh account boots with no snapshot and empty WAL.
2. WAL-only replay restores state correctly before the first snapshot exists.
3. Snapshot plus trailing WAL records restores state correctly after snapshotting.
4. Crash before metadata commit keeps the previous snapshot authoritative.
5. Multiple snapshot cycles preserve replay correctness without requiring WAL deletion.
6. WAL append is durable across tab close/reload without depending on an OPFS snapshot write landing first.

## Open Questions

- exact fallback file naming if OPFS move/rename semantics prove awkward in practice
- exact definition of the future sync-discharge frontier needed before WAL deletion can be enabled
