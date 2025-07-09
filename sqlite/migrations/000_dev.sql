-- notes on the data model
-- ts = custom timestamp for lww-register ("{utc}:{pid}:{tick}")
-- utc = native utc timestamp
-- TODO: item.type could be an enum (repeat, static, series, shuffle, playlist)
-- TODO: repeat could be a property...
-- TODO: Consider an sql trigger for updating timestamps

CREATE TABLE IF NOT EXISTS user (
  id UUID NOT NULL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace (
  id UUID NOT NULL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_workspace (
  id UUID NOT NULL PRIMARY KEY,
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  UNIQUE(user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS item (
  workspace_id UUID NOT NULL,
  id UUID NOT NULL PRIMARY KEY,
  text TEXT NOT NULL,
  text_ts STRING NOT NULL,
  type TEXT NOT NULL,
  type_ts STRING NOT NULL,
  repeat_break INTEGER NULL,
  repeat_break_ts STRING NOT NULL,
  repeat_target INTEGER NULL,
  repeat_target_ts STRING NOT NULL,
  updated_utc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS item_tombstone (
  workspace_id UUID NOT NULL,
  id UUID NOT NULL PRIMARY KEY,
  container_id UUID NOT NULL,
  item_id UUID NOT NULL,
  rip_utc TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS container (
  workspace_id UUID NOT NULL,
  id UUID NOT NULL PRIMARY KEY,
  title TEXT NOT NULL,
  updated_utc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS container_item (
  workspace_id UUID NOT NULL,
  id UUID NOT NULL PRIMARY KEY,
  container_id UUID NOT NULL,
  item_id UUID NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  order_index_ts STRING NOT NULL,
  FOREIGN KEY (container_id) REFERENCES container (id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES item (id) ON DELETE CASCADE,
  UNIQUE(container_id, item_id)
);

CREATE TABLE IF NOT EXISTS container_item_tombstone (
  workspace_id UUID NOT NULL,
  id UUID NOT NULL PRIMARY KEY,
  container_id UUID NOT NULL,
  item_id UUID NOT NULL,
  order_index INTEGER NOT NULL,
  order_index_ts STRING NOT NULL,
  rip_utc TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
