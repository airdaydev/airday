-- Airday initial schema. Sqlite-only for now. Multi-account from day one so the
-- SaaS Postgres path can reuse the shape.

CREATE TABLE accounts (
  id                          BLOB PRIMARY KEY,                -- uuid v7 bytes
  email                       TEXT UNIQUE NOT NULL,
  password_hash               BLOB NOT NULL,                   -- SHA-256(client auth_secret)
  password_salt               BLOB NOT NULL,                   -- master_salt for client KDF
  kdf_m_kib                   INTEGER NOT NULL,                -- argon2 memory (KiB)
  kdf_t                       INTEGER NOT NULL,                -- argon2 iterations
  kdf_p                       INTEGER NOT NULL,                -- argon2 parallelism
  wrapped_dek                 BLOB NOT NULL,
  wrapped_dek_nonce           BLOB NOT NULL,
  recovery_salt               BLOB,                            -- present iff recovery code opted in
  recovery_auth_hash          BLOB,                            -- SHA-256(client recovery_auth_secret)
  recovery_wrapped_dek        BLOB,
  recovery_wrapped_dek_nonce  BLOB,
  created_at                  INTEGER NOT NULL                 -- unix millis
);

CREATE TABLE recovery_sessions (
  token_hash      BLOB PRIMARY KEY,                            -- SHA-256(token)
  account_id      BLOB NOT NULL REFERENCES accounts(id),
  expires_at      INTEGER NOT NULL,
  consumed_at     INTEGER                                      -- nullable; set on /password/reset success
);
CREATE INDEX recovery_sessions_account_id_idx ON recovery_sessions (account_id);

CREATE TABLE devices (
  id                  BLOB PRIMARY KEY,                        -- uuid v7 bytes
  account_id          BLOB NOT NULL REFERENCES accounts(id),
  name                TEXT NOT NULL,
  auth_token_hash     BLOB NOT NULL,                           -- SHA-256(device_token bytes)
  last_acked_seq      INTEGER NOT NULL DEFAULT 0,              -- per-account contiguous-prefix frontier
  last_seen_at        INTEGER NOT NULL,
  created_at          INTEGER NOT NULL
);
CREATE INDEX devices_account_id_idx ON devices (account_id);
CREATE INDEX devices_token_hash_idx ON devices (auth_token_hash);

-- Per-account monotonic counter. Bumped inside the same transaction
-- that inserts ops so seqs are dense, contiguous, and gap-free for any
-- single account — clients spot real holes (replica lag, dropped frames)
-- instead of confusing them with "another account got that id".
CREATE TABLE account_sequences (
  account_id   BLOB PRIMARY KEY REFERENCES accounts(id),
  next_seq     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE ops (
  account_id      BLOB NOT NULL REFERENCES accounts(id),
  seq             INTEGER NOT NULL,                            -- per-account monotonic, gap-free
  payload         BLOB NOT NULL,
  payload_nonce   BLOB NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (account_id, seq)
);

CREATE TABLE snapshots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id            BLOB NOT NULL REFERENCES accounts(id),
  up_to_seq             INTEGER NOT NULL,                        -- encoded state frontier (per-account)
  compaction_floor_seq  INTEGER NOT NULL,                        -- seq at/below which op blobs are eligible for GC once this snapshot lands
  payload               BLOB NOT NULL,
  payload_nonce         BLOB NOT NULL,
  created_at            INTEGER NOT NULL
);
CREATE INDEX snapshots_account_id_idx ON snapshots (account_id, id DESC);
