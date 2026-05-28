-- Local doc storage for the airday CLI.
--
-- Each row is one Loro doc snapshot, keyed by the server-assigned
-- doc_id. Today the CLI only ever holds its account's primary doc
-- (1:1), so the table holds exactly one row — but keying on doc_id
-- mirrors the server's storage shape and lets shared docs land
-- without a schema migration. See spec/sharing-plan.md.

CREATE TABLE docs (
  doc_id      BLOB PRIMARY KEY,            -- uuid v7 bytes; matches server-side docs.id
  payload     BLOB NOT NULL,               -- Loro snapshot bytes
  updated_at  INTEGER NOT NULL             -- unix millis
);
