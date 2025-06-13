CREATE TABLE IF NOT EXISTS user (
  id UUID NOT NULL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT NOT NULL PRIMARY KEY,
  expires INTEGER NOT NULL,
  refresh_token TEXT NOT NULL,
  refresh_token_expires INTEGER NOT NULL,
  user_id UUID NOT NULL,
  user_agent TEXT NOT NULL,
  ip TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user (id)
);
