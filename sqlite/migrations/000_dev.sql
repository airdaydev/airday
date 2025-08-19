-- notes on the data model
-- *_utc = native utc timestamp
-- TODO: item.type could be an enum (repeat, static, series, shuffle, playlist)
-- TODO: repeat could be a property...
-- TODO: Consider an sql trigger for updating timestamps

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

CREATE TABLE IF NOT EXISTS item (
  -- static vals
  id UUID NOT NULL PRIMARY KEY,
  library_id UUID NOT NULL,
  -- core, mutable attributes via JSON{} Record<key, {utc: number, pid: number, data: any}> i.e. a map of LWWRegisters
  attributes TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes) AND json_type(attributes) = 'object'),
  -- TODO: We can implement dynamic attributes here (perhaps even enforce a schema)
  -- metadata & tombstone
  server_seq INTEGER NOT NULL, -- used to negotiate sync
  tombstone_utc INTEGER NULL
  -- TODO: deleted by?
);

CREATE TABLE IF NOT EXISTS container (
  library_id UUID NOT NULL,
  id UUID NOT NULL PRIMARY KEY,
  -- later, specific container type could be static here
  -- core, mutable attributes via JSON{} Record<key, {utc: number, pid: number, data: any}> i.e. a map of LWWRegisters
  attributes TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes) AND json_type(attributes) = 'object'),
  -- metadata & tombtone
  server_seq TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tombstone_utc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
