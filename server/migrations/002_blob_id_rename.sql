CREATE TABLE devices__blob_id_migration (
  id                  BLOB PRIMARY KEY,
  account_id          BLOB NOT NULL REFERENCES accounts(id),
  name                TEXT NOT NULL,
  auth_token_hash     BLOB NOT NULL,
  last_acked_blob_id  INTEGER NOT NULL DEFAULT 0,
  last_seen_at        INTEGER NOT NULL,
  created_at          INTEGER NOT NULL
);
INSERT INTO devices__blob_id_migration (
  id,
  account_id,
  name,
  auth_token_hash,
  last_acked_blob_id,
  last_seen_at,
  created_at
)
SELECT
  id,
  account_id,
  name,
  auth_token_hash,
  last_acked_op_id,
  last_seen_at,
  created_at
FROM devices;
DROP TABLE devices;
ALTER TABLE devices__blob_id_migration RENAME TO devices;
CREATE INDEX devices_account_id_idx ON devices (account_id);
CREATE INDEX devices_token_hash_idx ON devices (auth_token_hash);

CREATE TABLE ops__blob_id_migration (
  blob_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      BLOB NOT NULL REFERENCES accounts(id),
  payload         BLOB NOT NULL,
  payload_nonce   BLOB NOT NULL,
  created_at      INTEGER NOT NULL
);
INSERT INTO ops__blob_id_migration (
  blob_id,
  account_id,
  payload,
  payload_nonce,
  created_at
)
SELECT
  id,
  account_id,
  payload,
  payload_nonce,
  created_at
FROM ops
ORDER BY id;
DROP TABLE ops;
ALTER TABLE ops__blob_id_migration RENAME TO ops;
CREATE INDEX ops_account_id_idx ON ops (account_id, blob_id);

CREATE TABLE snapshots__blob_id_migration (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id            BLOB NOT NULL REFERENCES accounts(id),
  up_to_blob_id         INTEGER NOT NULL,
  shallow_start_blob_id INTEGER NOT NULL,
  payload               BLOB NOT NULL,
  payload_nonce         BLOB NOT NULL,
  created_at            INTEGER NOT NULL
);
INSERT INTO snapshots__blob_id_migration (
  id,
  account_id,
  up_to_blob_id,
  shallow_start_blob_id,
  payload,
  payload_nonce,
  created_at
)
SELECT
  id,
  account_id,
  up_to_op_id,
  shallow_start_op_id,
  payload,
  payload_nonce,
  created_at
FROM snapshots
ORDER BY id;
DROP TABLE snapshots;
ALTER TABLE snapshots__blob_id_migration RENAME TO snapshots;
CREATE INDEX snapshots_account_id_idx ON snapshots (account_id, id DESC);
