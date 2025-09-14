CREATE TABLE IF NOT EXISTS user (
  id UUID NOT NULL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  primary_library_id UUID NULL,
  FOREIGN KEY (primary_library_id) REFERENCES library (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS session (
  id UUID NOT NULL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  expires INTEGER NOT NULL,
  refresh_token TEXT NOT NULL,
  refresh_expires INTEGER NOT NULL,
  user_id UUID NOT NULL,
  user_agent TEXT NOT NULL,
  ip TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id)
);

CREATE TABLE IF NOT EXISTS library (
  id UUID NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  primary_library BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS user_library (
  user_id UUID NOT NULL,
  library_id UUID NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE,
  FOREIGN KEY (library_id) REFERENCES library (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, library_id)
);

CREATE TABLE IF NOT EXISTS sync_op (
  -- sync concerns
  seq INTEGER PRIMARY KEY AUTOINCREMENT, -- server_seq number
  base_seq INTEGER, -- snapshot seq base (renders lower seqs as void)
  op_kind INTEGER NOT NULL, -- 0=patch, 1=snapshot, 2=delete (potentially extend for text ops)
  enc BOOLEAN NOT NULL, -- encrypted or plain text
  -- static, immutable, identifiers
  library_id UUID NOT NULL,
  obj_id UUID NOT NULL,
  path INT NULL, -- useful for complex subtypes i.e. text crdt on a item
  obj_type INT NOT NULL CHECK (obj_type BETWEEN 0 AND 65535),
  -- (encrypted) map of lww-registers
  payload BLOB NOT NULL,
  payload_sha256 BLOB NOT NULL,
  -- Metadata & tombstone
  tombstone_utc INTEGER NULL,
  created_utc INTEGER NULL,
  client_id UUID NULL
);
