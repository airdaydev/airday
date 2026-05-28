# Storage

Sqlite for now. One database file per server instance. Multi-account, multi-doc from day one — the SaaS Postgres path will reuse the same shape.

The unit of sync is the **doc**, not the account. An account is a login identity; a doc is a Loro document with its own DEK, op stream, and snapshot chain. Every account has exactly one **primary doc** (their Home) plus zero or more shared docs they're a member of. The schema treats both kinds identically — "primary" is just a role on the membership row plus a convenience pointer from the account.

## Schema (`migrations/001_init.sql`)

```sql
CREATE TABLE accounts (
  id                   BLOB PRIMARY KEY,            -- uuid v7
  email                TEXT UNIQUE NOT NULL,
  password_hash        BLOB NOT NULL,               -- SHA-256(client auth_secret)
  password_salt        BLOB NOT NULL,               -- master_salt for client KDF
  recovery_salt        BLOB,                        -- present iff recovery code opted in
  recovery_auth_hash   BLOB,                        -- SHA-256(client recovery_auth_secret)
  primary_doc_id       BLOB NOT NULL,               -- FK to docs(id); the account's Home
  created_at           INTEGER NOT NULL             -- unix millis
);
-- DEK wraps live on doc_members, not here. The primary doc's wrap is on the
-- (primary_doc_id, this account, role='owner') membership row.

CREATE TABLE docs (
  id           BLOB PRIMARY KEY,                    -- uuid v7
  created_at   INTEGER NOT NULL
);
-- Docs have no FK to accounts. Access is mediated through doc_members.

CREATE TABLE doc_members (
  doc_id                       BLOB NOT NULL REFERENCES docs(id),
  account_id                   BLOB NOT NULL REFERENCES accounts(id),
  role                         TEXT NOT NULL,       -- 'owner' | 'member'
  wrapped_dek                  BLOB NOT NULL,       -- doc DEK wrapped with this member's KEK
  wrapped_dek_nonce            BLOB NOT NULL,
  recovery_wrapped_dek         BLOB,                -- doc DEK wrapped with this member's recovery KEK
  recovery_wrapped_dek_nonce   BLOB,
  added_at                     INTEGER NOT NULL,
  removed_at                   INTEGER,             -- nullable; soft-delete for audit (see "Member removal")
  PRIMARY KEY (doc_id, account_id)
);
CREATE INDEX doc_members_account_id_idx ON doc_members (account_id) WHERE removed_at IS NULL;

CREATE TABLE recovery_sessions (
  token_hash      BLOB PRIMARY KEY,                 -- SHA-256(token)
  account_id      BLOB NOT NULL REFERENCES accounts(id),
  expires_at      INTEGER NOT NULL,
  consumed_at     INTEGER                           -- nullable; set on /password/reset success
);
CREATE INDEX recovery_sessions_account_id_idx ON recovery_sessions (account_id);

CREATE TABLE devices (
  id              BLOB PRIMARY KEY,                 -- uuid v7
  account_id      BLOB NOT NULL REFERENCES accounts(id),
  name            TEXT NOT NULL,
  auth_token_hash TEXT NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX devices_account_id_idx ON devices (account_id);
-- last_acked_seq is per (device, doc); see device_doc_frontiers below.

CREATE TABLE device_doc_frontiers (
  device_id        BLOB NOT NULL REFERENCES devices(id),
  doc_id           BLOB NOT NULL REFERENCES docs(id),
  last_acked_seq   INTEGER NOT NULL DEFAULT 0,     -- per (device, doc) contiguous-prefix frontier
  PRIMARY KEY (device_id, doc_id)
);
CREATE INDEX device_doc_frontiers_doc_id_idx ON device_doc_frontiers (doc_id);

-- Per-doc monotonic counter. UPDATEd in the same tx as the op insert so
-- seqs are dense and gap-free for any single doc.
CREATE TABLE doc_sequences (
  doc_id     BLOB PRIMARY KEY REFERENCES docs(id),
  next_seq   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE ops (
  doc_id          BLOB NOT NULL REFERENCES docs(id),
  seq             INTEGER NOT NULL,                 -- per-doc monotonic, gap-free
  payload         BLOB NOT NULL,
  payload_nonce   BLOB NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (doc_id, seq)
);
-- No account_id column. Access is checked at WS subscribe-time via doc_members.

CREATE TABLE snapshots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id                BLOB NOT NULL REFERENCES docs(id),
  up_to_seq             INTEGER NOT NULL,    -- snapshot's encoded state frontier (per-doc)
  compaction_floor_seq  INTEGER NOT NULL,    -- seq at/below which op blobs are eligible for GC once this snapshot lands (= max(horizon, prev snapshot's compaction_floor_seq) at snapshot time). Doubles as the bootstrap gate.
  payload               BLOB NOT NULL,
  payload_nonce         BLOB NOT NULL,
  created_at            INTEGER NOT NULL
);
CREATE INDEX snapshots_doc_id_idx ON snapshots (doc_id, id DESC);
```

`ops.seq` is per-doc, dense, and gap-free. Hole detection on the client is meaningful: a missing seq is a real loss (replica lag, dropped frame, server bug), not "another doc got that id". The composite `(doc_id, seq)` PK doubles as the per-doc ordering index — no separate index needed.

The `doc_sequences` row for a doc is created on first `insert_ops` via `INSERT … ON CONFLICT DO UPDATE`, so doc creation doesn't need a separate seed step. Reads (`SELECT seq … ORDER BY seq`) never touch the counter; only writers contend on the per-doc row — and only writers on *the same doc* contend on the same row.

### Invariants the app maintains

- `accounts.primary_doc_id` always points to a row in `docs` where this account has an `owner` `doc_members` row with `removed_at IS NULL`. SQLite cannot express this with FKs; the signup transaction is responsible.
- Every active `doc_members` row carries a non-null `wrapped_dek` + `wrapped_dek_nonce`. Recovery wrap fields are non-null iff the account opted into recovery.

### Insertion order at signup

`docs` has no FK back to `accounts`, so the signup transaction is:

1. `INSERT INTO docs(...)` — generate the primary doc id.
2. `INSERT INTO accounts(..., primary_doc_id = <doc id from step 1>)`.
3. `INSERT INTO doc_members(doc_id, account_id, role='owner', wrapped_dek, ...)`.
4. `INSERT INTO devices(...)` for the signup device.

All in one tx with `BEGIN IMMEDIATE`.

## Compaction

After a snapshot lands, a background job may, **per doc**:
1. Delete `ops` rows where `doc_id = X AND seq ≤ snapshot.compaction_floor_seq`. (`compaction_floor_seq` is set to `max(horizon, prev snapshot's compaction_floor_seq)` at snapshot creation time by the orchestrator — see `sync-protocol.md` §"Snapshot orchestration" — so it's safe by construction.)
2. Keep at most M=2 snapshots per doc; delete older.

**Horizon for a doc** = `min(device_doc_frontiers.last_acked_seq)` across all rows where `doc_id = X` and the owning device's account is a current member (`doc_members.removed_at IS NULL`). A device with no `device_doc_frontiers` row for a doc it's a member of is treated as `last_acked_seq = 0`, holding the horizon at 0 until it first acks. A removed member's frontiers are excluded from the calculation immediately on removal.

Run on a timer, not synchronous with snapshot upload. The `doc_sequences.next_seq` counter is **not** rewound by compaction — `next_seq` keeps climbing even when the rows below the snapshot floor are pruned.

## Sqlite settings

- WAL mode (`PRAGMA journal_mode=WAL`).
- `PRAGMA synchronous=NORMAL` for write throughput; durability is per-WAL-checkpoint.
- `PRAGMA busy_timeout=5000`.
- `PRAGMA foreign_keys=ON`.

## Migrations

- `001_init.sql` creates the current schema for fresh servers. Pre-release: any earlier prototype schemas are dropped, not migrated.

## Open questions

- Backup story for self-hosted (online backup via `VACUUM INTO`? out of scope for now).
- Sharing endpoints + `doc_invites` table are planned but unimplemented; see `sharing.md`. The schema above is the v1 implementation; sharing adds a `doc_invites` table without changing existing tables.
