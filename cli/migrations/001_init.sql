-- Local doc storage for the airday CLI (spec/local-storage.md):
-- an append-only `ops` log keyed by (doc_id, local_seq) plus one
-- `snapshots` row per doc. Mirrors the sqlite schema the server uses.
--
-- Today the CLI only ever holds its account's primary doc (1:1), so
-- `docs` holds exactly one row — but keying everything on doc_id mirrors
-- the server's storage shape and lets shared docs land without a schema
-- migration. See spec/sharing-plan.md.

CREATE TABLE docs (
  id          BLOB PRIMARY KEY,            -- uuid v7 bytes; matches server-side docs.id
  created_at  INTEGER NOT NULL             -- unix seconds (unixepoch())
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
  up_to_local_seq INTEGER NOT NULL,         -- highest local_seq folded into payload
  payload         BLOB NOT NULL,            -- EncryptedBlob.ciphertext (full-state snapshot)
  payload_nonce   BLOB NOT NULL,
  created_at      INTEGER NOT NULL
);
