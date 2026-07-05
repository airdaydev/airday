//! Native sqlite `LocalStorage` for Airday.
//!
//! `SqliteStorage` is the native implementation of `airday_core::LocalStorage`:
//! plain `rusqlite` behind a `Mutex`, synchronously durable (the trait
//! method returns only after the `INSERT`/`UPDATE` commits). The generic
//! schema is `migrations/001_init.sql` — an append-only `ops` log plus one
//! `snapshots` row per doc, keyed by `doc_id`.
//!
//! This crate was hoisted out of the CLI so an FFI build (Apple, future
//! native clients) can share the exact same storage without pulling in
//! the CLI. It stays deliberately client-agnostic: it owns only the
//! shared doc-storage tables and the `_migrations` ledger. A caller that
//! needs its own tables (the CLI's singleton `account` identity row)
//! supplies them as *extra* migrations via [`SqliteStorage::open_with_extra`],
//! so identity and the doc cache share one db file and one transactional
//! store. Boot / seed / load glue lives in `airday_core::storage` — it is
//! generic over the trait and DEK-holding, so it belongs beside the trait,
//! not here.
//!
//! `core/` must stay wasm-clean, so this crate — not `airday-core` — is
//! where `rusqlite` lands.

use std::path::Path;
use std::sync::{Arc, Mutex};

use airday_core::{
    BootState, ClientOpId, DocId, LocalOpRow, LocalSeq, LocalStorage, OutboxRow, RemoteOpRow,
    ReplayRow, ServerSeq, SnapshotCutoff, SnapshotRow, StorageError,
};
use airday_protocol::EncryptedBlob;
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

const MIGRATION_001: &str = include_str!("../migrations/001_init.sql");

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Native `LocalStorage` over a sqlite file.
///
/// `Clone` is shallow: clones share one `Connection` behind the
/// `Arc<Mutex>`, so an engine and its owning session can both hold a
/// handle to the *same* db without a second file open. WAL + the `Mutex`
/// serialise their accesses.
#[derive(Clone)]
pub struct SqliteStorage {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteStorage {
    /// Open (creating + migrating if needed) the sqlite file at `path`,
    /// applying only the generic doc-storage schema.
    pub fn open(path: &Path) -> Result<Self, DbError> {
        Self::open_with_extra(path, &[])
    }

    /// As [`open`](Self::open), but also apply caller-supplied extra
    /// migrations against the same db file after the core schema. Each
    /// entry is `(ledger_name, sql)`; `ledger_name` must be distinct from
    /// the core `"001_init"` and from every other extra migration, since
    /// the shared `_migrations` table dedupes by name. Used by the CLI to
    /// add its `account` table to the same file (see spec/cli.md).
    pub fn open_with_extra(path: &Path, extra: &[(&str, &str)]) -> Result<Self, DbError> {
        let mut conn = Connection::open(path)?;
        apply_pragmas(&conn)?;
        run_migrations(&mut conn, extra)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Wrap an already-open, already-migrated connection. Lets a caller
    /// that opened the db another way (or wants a second `SqliteStorage`
    /// view over an existing handle) reuse it — the shared connection is
    /// the single serialisation point.
    pub fn from_connection(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// The shared connection handle. Exposed so callers can run their own
    /// (non-doc) queries — e.g. the CLI's `account` / sync-cursor rows —
    /// against the same transactional store the trait writes to.
    pub fn connection(&self) -> &Arc<Mutex<Connection>> {
        &self.conn
    }
}

fn apply_pragmas(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=5000;
         PRAGMA foreign_keys=ON;",
    )?;
    Ok(())
}

fn run_migrations(conn: &mut Connection, extra: &[(&str, &str)]) -> Result<(), DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
           name        TEXT PRIMARY KEY,
           applied_at  INTEGER NOT NULL
         );",
    )?;
    apply_migration(conn, "001_init", MIGRATION_001)?;
    for (name, sql) in extra {
        apply_migration(conn, name, sql)?;
    }
    Ok(())
}

fn apply_migration(c: &mut Connection, name: &str, sql: &str) -> Result<(), DbError> {
    if migration_applied(c, name)? {
        return Ok(());
    }
    let tx = c.transaction()?;
    tx.execute_batch(sql)?;
    tx.execute(
        "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
        params![name, now_millis()],
    )?;
    tx.commit()?;
    Ok(())
}

fn migration_applied(c: &Connection, name: &str) -> Result<bool, DbError> {
    let found = c
        .query_row("SELECT 1 FROM _migrations WHERE name = ?", [name], |r| {
            r.get::<_, i64>(0)
        })
        .map(|_| true)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(false),
            other => Err(other),
        })?;
    Ok(found)
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl LocalStorage for SqliteStorage {
    fn boot(&self, doc_id: DocId) -> Result<BootState, StorageError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();

        let snapshot = conn
            .query_row(
                "SELECT up_to_local_seq, payload, payload_nonce FROM snapshots WHERE doc_id = ?1",
                [&id],
                |r| {
                    Ok(SnapshotRow {
                        up_to_local_seq: LocalSeq(r.get::<_, i64>(0)? as u64),
                        payload: blob_from(r.get(1)?, r.get(2)?),
                    })
                },
            )
            .optional()
            .map_err(backend)?;

        // Replay every surviving row: `write_snapshot` already pruned the
        // rows the snapshot contains, so there's no `local_seq` cutoff to
        // apply here. Pending and above-frontier rows sit below the
        // high-water and would be wrongly skipped by a prefix filter.
        let replay = {
            let mut stmt = conn
                .prepare(
                    "SELECT local_seq, payload, payload_nonce FROM ops
                     WHERE doc_id = ?1 ORDER BY local_seq",
                )
                .map_err(backend)?;
            let rows = stmt
                .query_map(params![id], |r| {
                    Ok(ReplayRow {
                        local_seq: LocalSeq(r.get::<_, i64>(0)? as u64),
                        payload: blob_from(r.get(1)?, r.get(2)?),
                    })
                })
                .map_err(backend)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(backend)?
        };

        let last_local_seq = LocalSeq(max_local_seq(&conn, &id)?);
        // Read the persisted cursor, not `MAX(ops.server_seq)` — the
        // latter underestimates once compaction prunes the acked ops it
        // was derived from. See `docs.last_acked_server_seq`.
        let last_acked: i64 = conn
            .query_row(
                "SELECT COALESCE(last_acked_server_seq, 0) FROM docs WHERE id = ?1",
                [&id],
                |r| r.get(0),
            )
            .optional()
            .map_err(backend)?
            .unwrap_or(0);

        Ok(BootState {
            snapshot,
            replay,
            last_local_seq,
            last_acked_server_seq: ServerSeq(last_acked as u64),
        })
    }

    fn append_local_op(&self, doc_id: DocId, row: LocalOpRow) -> Result<LocalSeq, StorageError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();
        ensure_doc(&conn, &id)?;
        let next = max_local_seq(&conn, &id)? + 1;
        conn.execute(
            "INSERT INTO ops
               (doc_id, local_seq, client_op_id, server_seq, payload, payload_nonce, created_at)
             VALUES (?1, ?2, ?3, NULL, ?4, ?5, unixepoch())",
            params![
                id,
                next as i64,
                row.client_op_id.0.as_bytes().to_vec(),
                row.payload.ciphertext,
                row.payload.nonce,
            ],
        )
        .map_err(backend)?;
        Ok(LocalSeq(next))
    }

    fn append_remote_op(&self, doc_id: DocId, row: RemoteOpRow) -> Result<LocalSeq, StorageError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();
        ensure_doc(&conn, &id)?;
        // Idempotent: a re-delivered server_seq (resume re-pull,
        // broadcast overlap) is already stored — return its local_seq
        // rather than violating the server_seq unique index or minting
        // a phantom local_seq.
        if let Some(existing) = conn
            .query_row(
                "SELECT local_seq FROM ops WHERE doc_id = ?1 AND server_seq = ?2",
                params![id, row.server_seq.0 as i64],
                |r| r.get::<_, i64>(0),
            )
            .optional()
            .map_err(backend)?
        {
            return Ok(LocalSeq(existing as u64));
        }
        let next = max_local_seq(&conn, &id)? + 1;
        conn.execute(
            "INSERT INTO ops
               (doc_id, local_seq, client_op_id, server_seq, payload, payload_nonce, created_at)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, unixepoch())",
            params![
                id,
                next as i64,
                row.server_seq.0 as i64,
                row.payload.ciphertext,
                row.payload.nonce,
            ],
        )
        .map_err(backend)?;
        Ok(LocalSeq(next))
    }

    fn ack_local_op(
        &self,
        doc_id: DocId,
        client_op_id: ClientOpId,
        server_seq: ServerSeq,
    ) -> Result<(), StorageError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();
        let changed = conn
            .execute(
                "UPDATE ops SET server_seq = ?1 WHERE doc_id = ?2 AND client_op_id = ?3",
                params![server_seq.0 as i64, id, client_op_id.0.as_bytes().to_vec()],
            )
            .map_err(backend)?;
        if changed == 0 {
            return Err(StorageError::UnknownClientOpId(client_op_id));
        }
        Ok(())
    }

    fn outbox(&self, doc_id: DocId) -> Result<Vec<OutboxRow>, StorageError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();
        let mut stmt = conn
            .prepare(
                "SELECT local_seq, client_op_id, payload, payload_nonce FROM ops
                 WHERE doc_id = ?1 AND client_op_id IS NOT NULL AND server_seq IS NULL
                 ORDER BY local_seq",
            )
            .map_err(backend)?;
        // Manual row loop (rather than `query_map`) so the `client_op_id`
        // bytes → `Uuid` parse can surface a `StorageError` directly,
        // instead of squeezing through `query_map`'s rusqlite-only error
        // channel.
        let mut rows = stmt.query([&id]).map_err(backend)?;
        let mut out = Vec::new();
        while let Some(r) = rows.next().map_err(backend)? {
            let local_seq: i64 = r.get(0).map_err(backend)?;
            let client_op_id: Vec<u8> = r.get(1).map_err(backend)?;
            let ciphertext: Vec<u8> = r.get(2).map_err(backend)?;
            let nonce: Vec<u8> = r.get(3).map_err(backend)?;
            out.push(OutboxRow {
                local_seq: LocalSeq(local_seq as u64),
                client_op_id: ClientOpId(uuid_from_slice(&client_op_id)?),
                payload: EncryptedBlob { nonce, ciphertext },
            });
        }
        Ok(out)
    }

    fn write_snapshot(
        &self,
        doc_id: DocId,
        cutoff: SnapshotCutoff,
        payload: EncryptedBlob,
    ) -> Result<(), StorageError> {
        let mut conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();
        let tx = conn.transaction().map_err(backend)?;
        ensure_doc(&tx, &id)?;
        // Record the current high-water (before pruning drops the rows
        // carrying it) so post-prune `append_*` stays monotonic.
        let high_water = max_local_seq(&tx, &id)? as i64;
        tx.execute(
            "INSERT INTO snapshots
               (doc_id, up_to_local_seq, payload, payload_nonce, created_at)
             VALUES (?1, ?2, ?3, ?4, unixepoch())
             ON CONFLICT(doc_id) DO UPDATE SET
               up_to_local_seq = excluded.up_to_local_seq,
               payload         = excluded.payload,
               payload_nonce   = excluded.payload_nonce,
               created_at      = excluded.created_at",
            params![id, high_water, payload.ciphertext, payload.nonce],
        )
        .map_err(backend)?;
        match cutoff {
            // Drop confirmed rows the snapshot contains; keep pending
            // (NULL server_seq) and above-frontier rows.
            SnapshotCutoff::ServerFrontier(frontier) => {
                tx.execute(
                    "DELETE FROM ops
                     WHERE doc_id = ?1 AND server_seq IS NOT NULL AND server_seq <= ?2",
                    params![id, frontier.0 as i64],
                )
                .map_err(backend)?;
            }
            SnapshotCutoff::LocalPrefix(up_to) => {
                tx.execute(
                    "DELETE FROM ops WHERE doc_id = ?1 AND local_seq <= ?2",
                    params![id, up_to.0 as i64],
                )
                .map_err(backend)?;
            }
        }
        tx.commit().map_err(backend)?;
        Ok(())
    }

    fn write_acked_seq(&self, doc_id: DocId, seq: ServerSeq) -> Result<(), StorageError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();
        ensure_doc(&conn, &id)?;
        conn.execute(
            "UPDATE docs SET last_acked_server_seq = ?2 WHERE id = ?1",
            params![id, seq.0 as i64],
        )
        .map_err(backend)?;
        Ok(())
    }
}

fn backend(e: rusqlite::Error) -> StorageError {
    StorageError::Backend(e.to_string())
}

fn blob_from(ciphertext: Vec<u8>, nonce: Vec<u8>) -> EncryptedBlob {
    EncryptedBlob { nonce, ciphertext }
}

fn uuid_from_slice(bytes: &[u8]) -> Result<Uuid, StorageError> {
    Uuid::from_slice(bytes).map_err(|e| StorageError::Backend(format!("invalid uuid bytes: {e}")))
}

fn ensure_doc(conn: &Connection, id: &[u8]) -> Result<(), StorageError> {
    conn.execute(
        "INSERT OR IGNORE INTO docs (id, created_at) VALUES (?1, unixepoch())",
        [id],
    )
    .map_err(backend)?;
    Ok(())
}

/// `max(snapshot.up_to_local_seq, max ops.local_seq)` — the highest
/// `local_seq` ever assigned for this doc. The snapshot term (its stored
/// high-water) matters after a prune deletes the rows carrying the max:
/// otherwise the next `append_*` would restart `local_seq` and collide
/// with a surviving pending row.
fn max_local_seq(conn: &Connection, id: &[u8]) -> Result<u64, StorageError> {
    let n: i64 = conn
        .query_row(
            "SELECT MAX(
                 COALESCE((SELECT MAX(local_seq)      FROM ops       WHERE doc_id = ?1), 0),
                 COALESCE((SELECT up_to_local_seq     FROM snapshots WHERE doc_id = ?1), 0)
             )",
            [id],
            |r| r.get(0),
        )
        .map_err(backend)?;
    Ok(n as u64)
}
