-- Local doc storage for the airday CLI.
--
-- Single-row blob table for now — a drop-in replacement for the
-- previous `loro.bin` file. The Storage trait + WAL/snapshot split
-- (see spec/idb-wal.md for the web equivalent) will reshape this in a
-- follow-up; treat this schema as throwaway.

CREATE TABLE doc_snapshot (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  payload     BLOB NOT NULL,
  updated_at  INTEGER NOT NULL
);
