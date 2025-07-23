-- notes on the data model
-- *_utc = native utc timestamp
-- TODO: item.type could be an enum (repeat, static, series, shuffle, playlist)
-- TODO: repeat could be a property...
-- TODO: Consider an sql trigger for updating timestamps

CREATE TABLE IF NOT EXISTS user (
  id UUID NOT NULL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  primary_workspace_id UUID NULL,
  FOREIGN KEY (primary_workspace_id) REFERENCES workspace (id) ON DELETE SET NULL
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

CREATE TABLE IF NOT EXISTS workspace (
  id UUID NOT NULL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_workspace (
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS item (
  -- static vals
  id UUID NOT NULL PRIMARY KEY,
  workspace_id UUID NOT NULL,
  -- core, mutable attributes via JSON{} Record<key, {utc: number, pid: number, data: any}> i.e. a map of LWWRegisters
  attributes TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes) AND json_type(attributes) = 'object'),
  -- TODO: We can implement dynamic attributes here (perhaps even enforce a schema)
  -- metadata & tombstone
  updated_utc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tombstone_utc TIMESTAMP NULL
  -- TODO: deleted by?
);

CREATE TABLE IF NOT EXISTS container (
  workspace_id UUID NOT NULL,
  id UUID NOT NULL PRIMARY KEY,
  -- later, specific container type could be static here
  -- core, mutable attributes via JSON{} Record<key, {utc: number, pid: number, data: any}> i.e. a map of LWWRegisters
  attributes TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes) AND json_type(attributes) = 'object'),
  -- metadata & tombtone
  updated_utc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tombstone_utc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
