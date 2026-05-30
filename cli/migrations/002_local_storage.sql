-- Replace 001_init's single-row docs(payload) blob with the shared
-- LocalStorage layout (spec/local-storage-plan.md): an append-only
-- `ops` log keyed by (doc_id, local_seq) plus one `snapshots` row per
-- doc. Mirrors the sqlite schema the server side uses.
--
-- The old `docs` table is preserved as `docs_legacy_v1` rather than
-- dropped: its blob is an *unencrypted* `Doc::save()` envelope, so it
-- can't be copied into a sealed `snapshots` row in pure SQL. The CLI
-- boot layer (which holds the DEK) drains it into a sealed snapshot on
-- first boot, then drops the table.

ALTER TABLE docs RENAME TO docs_legacy_v1;

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
