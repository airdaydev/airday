# Storage

Sqlite for now. One database file per server instance. Single-tenant (one account per server) is *not* assumed — the schema is multi-account from day one because the SaaS Postgres path will reuse the same shape.

## Schema (`migrations/001_init.sql`)

```sql
CREATE TABLE accounts (
  id                          BLOB PRIMARY KEY,            -- uuid v7
  email                       TEXT UNIQUE NOT NULL,
  password_hash               BLOB NOT NULL,               -- SHA-256(client auth_secret)
  password_salt               BLOB NOT NULL,               -- master_salt for client KDF
  wrapped_dek                 BLOB NOT NULL,
  wrapped_dek_nonce           BLOB NOT NULL,
  recovery_salt               BLOB,                        -- present iff recovery code opted in
  recovery_auth_hash          BLOB,                        -- SHA-256(client recovery_auth_secret)
  recovery_wrapped_dek        BLOB,
  recovery_wrapped_dek_nonce  BLOB,
  created_at                  INTEGER NOT NULL             -- unix millis
);

CREATE TABLE recovery_sessions (
  token_hash      BLOB PRIMARY KEY,                        -- SHA-256(token)
  account_id      BLOB NOT NULL REFERENCES accounts(id),
  expires_at      INTEGER NOT NULL,
  consumed_at     INTEGER                                  -- nullable; set on /password/reset success
);
CREATE INDEX recovery_sessions_account_id_idx ON recovery_sessions (account_id);

CREATE TABLE devices (
  id                  BLOB PRIMARY KEY,                    -- uuid v7
  account_id          BLOB NOT NULL REFERENCES accounts(id),
  name                TEXT NOT NULL,
  auth_token_hash     TEXT NOT NULL,
  last_acked_op_id    INTEGER NOT NULL DEFAULT 0,
  last_seen_at        INTEGER NOT NULL,
  created_at          INTEGER NOT NULL
);
CREATE INDEX devices_account_id_idx ON devices (account_id);

CREATE TABLE ops (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,        -- monotonic per-server
  account_id      BLOB NOT NULL REFERENCES accounts(id),
  payload         BLOB NOT NULL,
  payload_nonce   BLOB NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX ops_account_id_idx ON ops (account_id, id);

CREATE TABLE snapshots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id            BLOB NOT NULL REFERENCES accounts(id),
  up_to_op_id           INTEGER NOT NULL,    -- snapshot's encoded state frontier
  shallow_start_op_id   INTEGER NOT NULL,    -- retained-history start; doubles as compaction floor (= max(horizon, prev snapshot's shallow_start) at snapshot time)
  payload               BLOB NOT NULL,
  payload_nonce         BLOB NOT NULL,
  created_at            INTEGER NOT NULL
);
CREATE INDEX snapshots_account_id_idx ON snapshots (account_id, id DESC);
```

Note: `ops.id` is global-monotonic, not per-account. Per-account ordering is `(account_id, id)`. This keeps ack math simple.

## Compaction

After a snapshot lands, a background job may:
1. Delete `ops` rows where `account_id = X AND id ≤ snapshot.shallow_start_op_id`. (`shallow_start_op_id` is set to `max(horizon, prev snapshot's shallow_start)` at snapshot creation time by the orchestrator — see `sync-protocol.md` §"Snapshot orchestration" — so it's safe by construction.)
2. Keep at most M=2 snapshots per account; delete older.

Run on a timer, not synchronous with snapshot upload.

## Sqlite settings

- WAL mode (`PRAGMA journal_mode=WAL`).
- `PRAGMA synchronous=NORMAL` for write throughput; durability is per-WAL-checkpoint.
- `PRAGMA busy_timeout=5000`.
- `PRAGMA foreign_keys=ON`.

## Migrations

Single `001_init.sql` for now. Greenfield — until v1.0, we reset the DB rather than migrate.

## Open questions

- Backup story for self-hosted (online backup via `VACUUM INTO`? out of scope for now).
