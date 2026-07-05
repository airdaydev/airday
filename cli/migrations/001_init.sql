-- CLI-only schema (spec/cli.md "Local state"). The generic doc-storage
-- tables (`docs`, `ops`, `snapshots`) live in `airday-storage-sqlite`
-- and are applied first against the same db file; this migration adds
-- only the CLI's identity row. Registered in the shared `_migrations`
-- ledger under a distinct name (see `open_storage`) so it doesn't
-- collide with the storage crate's own `001_init`.

-- Singleton (id pinned to 1): the account + device identity this
-- install is logged in as. Server-assigned, written once at
-- signup/login/recover. `primary_doc_id` is the Home doc's uuid bytes
-- (matches docs.id). Lives in the db rather than a config file so
-- identity and the doc cache share one transactional store; the
-- presence of `secrets.toml` (not this row) is the "logged in" marker.
CREATE TABLE account (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  account_id     TEXT NOT NULL,
  email          TEXT NOT NULL,
  device_id      TEXT NOT NULL,
  primary_doc_id BLOB NOT NULL
);
