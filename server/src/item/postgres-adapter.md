This is a summary of a conversation w/chatgpt5 re. adapting merge for postgresql while keeping valid CRDT properties across servers:

Perfect—if `updated_utc` is provably monotonic on a **single writer process** (your server), your CAS is sound and you’re done for now. Just keep the tiny retry loop and you’re golden.

Since you’ll later add a PostgreSQL adapter (multi-server), here’s a compact checklist you can drop in when you switch:

# Postgres-ready checklist (for multi-server)

1. **Keep CAS on a version counter**

```sql
ALTER TABLE item ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
-- Update path
UPDATE item
   SET attributes = $1,
       updated_utc = $2,
       version = version + 1
 WHERE library_id = $3 AND id = $4
   AND tombstone_utc IS NULL
   AND version = $5
RETURNING updated_utc, version;
```

* On 0 rows affected: re-read → re-merge → retry.

2. **Add a drift-proof sync watermark using a sequence**
   (So clients can “grab last updated” without trusting clocks.)

```sql
CREATE SEQUENCE IF NOT EXISTS item_clock;

ALTER TABLE item
  ADD COLUMN updated_seq BIGINT NOT NULL DEFAULT nextval('item_clock');

CREATE OR REPLACE FUNCTION bump_item_clock()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_seq := nextval('item_clock');
  RETURN NEW;
END $$;

CREATE TRIGGER item_bump_ins BEFORE INSERT ON item
FOR EACH ROW EXECUTE FUNCTION bump_item_clock();

CREATE TRIGGER item_bump_upd BEFORE UPDATE ON item
FOR EACH ROW EXECUTE FUNCTION bump_item_clock();

CREATE INDEX IF NOT EXISTS item_lib_seq ON item(library_id, updated_seq);
```

* Client “last updated”: `SELECT updated_seq FROM item WHERE library_id = $1 ORDER BY updated_seq DESC LIMIT 1;`
* Paging: `WHERE updated_seq > $cursor ORDER BY updated_seq LIMIT $n;`
* Gaps from rollbacks are fine; order remains monotonic.

3. **One-statement UPSERT that merges (optional but great)**
   If you expose a deterministic merge UDF (e.g., `crdt_merge(jsonb, jsonb)`):

```sql
INSERT INTO item (library_id, id, attributes, updated_utc, version)
VALUES ($1, $2, $3, $4, 0)
ON CONFLICT (library_id, id) DO UPDATE
  SET attributes   = crdt_merge(item.attributes, EXCLUDED.attributes),
      updated_utc  = GREATEST(item.updated_utc, EXCLUDED.updated_utc),
      version      = item.version + 1,
      updated_seq  = nextval('item_clock')
RETURNING updated_utc, version, updated_seq;
```

This removes the read-merge-write window entirely.

4. **Change feed (if you want a clean log)**

```sql
CREATE TABLE IF NOT EXISTS item_change_log(
  seq BIGSERIAL PRIMARY KEY,
  library_id UUID NOT NULL,
  id UUID NOT NULL,
  updated_utc BIGINT NOT NULL
);
-- AFTER INSERT/UPDATE trigger to append (same tx)
```

5. **HA note**

* If PG runs single-primary (typical), the sequence and row locks already serialize writers—no HLC needed.
* If you ever go multi-primary or sharded, switch to HLC or `(shard_id, seq)` pairs for global ordering.
