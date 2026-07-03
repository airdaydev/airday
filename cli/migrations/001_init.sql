-- Local doc storage for the airday CLI (spec/local-storage.md):
-- an append-only `ops` log keyed by (doc_id, local_seq) plus one
-- `snapshots` row per doc. Mirrors the sqlite schema the server uses.
--
-- Today the CLI only ever holds its account's primary doc (1:1), so
-- `docs` holds exactly one row — but keying everything on doc_id mirrors
-- the server's storage shape and lets shared docs land without a schema
-- migration. See spec/sharing-plan.md.

CREATE TABLE docs (
  id                    BLOB PRIMARY KEY,    -- uuid v7 bytes; matches server-side docs.id
  created_at            INTEGER NOT NULL,    -- unix seconds (unixepoch())
  -- Per-doc sync cursor. `last_acked_server_seq` is the highest
  -- server_seq this device has pulled+applied; it's persisted here
  -- (rather than derived from MAX(ops.server_seq)) so it survives
  -- compaction pruning the very ops it was derived from. `last_sync_at`
  -- is unix millis of the last successful online flush; NULL = never.
  last_acked_server_seq INTEGER NOT NULL DEFAULT 0,
  last_sync_at          INTEGER
);

-- Singleton (id pinned to 1): the account + device identity this
-- install is logged in as. Server-assigned, written once at
-- signup/login/recover. `primary_doc_id` is the Home doc's uuid bytes
-- (matches docs.id). Lives in the db rather than a config file so
-- identity and the doc cache share one transactional store; the
-- presence of `secrets.toml` (not this row) is the "logged in" marker.
CREATE TABLE account (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  account_id     TEXT NOT NULL,
  email          TEXT NOT NULL,
  device_id      TEXT NOT NULL,
  primary_doc_id BLOB NOT NULL
);

CREATE TABLE ops (
  doc_id        BLOB NOT NULL REFERENCES docs(id),
  local_seq     INTEGER NOT NULL,          -- dense, per-doc, storage-assigned
  client_op_id  BLOB,                       -- uuid bytes; NULL for remote-origin ops
  server_seq    INTEGER,                    -- NULL until acked / for local ops in the outbox
  payload       BLOB NOT NULL,              -- EncryptedBlob.ciphertext (DEK-sealed)
  payload_nonce BLOB NOT NULL,              -- EncryptedBlob.nonce
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (doc_id, local_seq)
);

CREATE UNIQUE INDEX ops_client_op_id_idx ON ops (doc_id, client_op_id) WHERE client_op_id IS NOT NULL;
CREATE UNIQUE INDEX ops_server_seq_idx   ON ops (doc_id, server_seq)   WHERE server_seq IS NOT NULL;

CREATE TABLE snapshots (
  doc_id          BLOB PRIMARY KEY REFERENCES docs(id),
  up_to_local_seq INTEGER NOT NULL,         -- local-counter high-water at write time (keeps local_seq monotonic after a prune); NOT a replay cutoff
  payload         BLOB NOT NULL,            -- EncryptedBlob.ciphertext (full-state snapshot)
  payload_nonce   BLOB NOT NULL,
  created_at      INTEGER NOT NULL
);
