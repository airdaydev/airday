CREATE TABLE IF NOT EXISTS user (
  id UUID NOT NULL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  primary_library_id UUID NULL,
  FOREIGN KEY (primary_library_id) REFERENCES library (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS session (
  id UUID NOT NULL PRIMARY KEY,
  user_id UUID NOT NULL,
  user_agent TEXT NOT NULL,
  ip TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id)
);

CREATE TABLE IF NOT EXISTS session_token (
  session_id UUID NOT NULL,
  hash BYTES UNIQUE NOT NULL,
  expires INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('SESSION', 'REFRESH')),
  FOREIGN KEY (session_id) REFERENCES session (id)
  PRIMARY KEY (session_id, kind)
);

-- seq can be incremented in blocks - allocating a range for transaction size of sync ops
CREATE TABLE IF NOT EXISTS library (
  id UUID NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  primary_library BOOLEAN NOT NULL DEFAULT FALSE,
  seq INTEGER NOT NULL DEFAULT 0
);

-- Relationship between users and libraries
CREATE TABLE IF NOT EXISTS user_library (
  user_id UUID NOT NULL,
  library_id UUID NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE,
  FOREIGN KEY (library_id) REFERENCES library (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, library_id)
);

CREATE TABLE IF NOT EXISTS sync_op (
  op_id UUID UNIQUE NOT NULL,
  -- sync concerns
  seq INTEGER NOT NULL, -- server_seq number
  base_seq INTEGER, -- snapshot seq base (renders lower seqs as void)
  -- crdt concerns
  op_kind INTEGER NOT NULL, -- 0=patch, 1=delete, 2=snapshot (potentially extend for text ops)
  archived BOOLEAN NOT NULL DEFAULT TRUE, -- to be deleted, depending on server compaction policy
  -- static, immutable, identifiers
  library_id UUID NOT NULL,
  obj_id UUID NOT NULL,
  path INT NOT NULL DEFAULT 0, -- useful for complex subtypes i.e. text crdt on a item (0 = no path)
  obj_kind INT NOT NULL CHECK (obj_kind BETWEEN 0 AND 65535),
  -- (encrypted) map of lww-registers
  payload BLOB NOT NULL,
  payload_sha256 BLOB NOT NULL,
  -- Metadata & tombstone
  created_utc INTEGER NOT NULL,
  client_id UUID NULL,
  -- TODO: Reconsider indexes etc
  PRIMARY KEY (library_id, seq)
) WITHOUT ROWID;

-- CREATE INDEX library_id_seq ON sync_op(library_id, seq);
-- CREATE UNIQUE INDEX ux_sync_op_lib_opid ON sync_op(op_id);
-- idemopotency guard
-- CREATE UNIQUE INDEX IF NOT EXISTS ux_sync_op_lib_opid
--   ON sync_op(library_id, op_id);
-- -- Speed up catch ups (reusing seq accidentally not really a problem if we anticipated it)
-- CREATE INDEX IF NOT EXISTS library_id_seq ON sync_op(library_id, seq);
