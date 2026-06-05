//! CLI local persistence.
//!
//! `SqliteStorage` is the native `LocalStorage` implementation: plain
//! `rusqlite` behind a `Mutex`, synchronously durable (the trait method
//! returns only after the `INSERT`/`UPDATE` commits). The schema is
//! `cli/migrations/001_init.sql` — an append-only `ops` log plus one
//! `snapshots` row per doc.
//!
//! The free functions at the bottom (`boot_doc`, `seed_snapshot`,
//! `load_doc`) turn the trait into a live `Doc`: they hold the DEK and
//! handle seal/open, so the trait itself stays key-agnostic (it only
//! ever sees opaque `EncryptedBlob`s).

use std::path::Path;
use std::sync::{Arc, Mutex};

use airday_core::{
    BootState, ClientOpId, Dek, Doc, DocError, DocId, LocalOpRow, LocalSeq, LocalStorage,
    OutboxRow, RemoteOpRow, ReplayRow, ServerSeq, SnapshotRow, StorageError,
};
use airday_protocol::EncryptedBlob;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::config::Profile;
use crate::db::{self, DbError};

/// The account + device identity this install is logged in as. Persisted
/// as the singleton `account` row (see `001_init.sql`); written once at
/// signup/login/recover, read by every command that needs identity.
#[derive(Debug, Clone)]
pub struct Account {
    pub account_id: String,
    pub email: String,
    pub device_id: String,
    /// The account's primary (Home) doc. Server-assigned at signup.
    pub primary_doc_id: DocId,
}

/// Per-doc sync cursor (the `last_acked_server_seq` / `last_sync_at`
/// columns on `docs`). `last_acked_server_seq` is the highest server_seq
/// pulled+applied — the pull cursor for the next sync. `last_sync_at` is
/// unix millis of the last successful online flush (`None` = never).
#[derive(Debug, Clone, Copy)]
pub struct SyncCursor {
    pub last_acked_server_seq: ServerSeq,
    pub last_sync_at: Option<i64>,
}

/// Native `LocalStorage` over a per-profile sqlite file.
///
/// `Clone` is shallow: clones share one `Connection` behind the `Arc<Mutex>`,
/// so the engine and the owning `Session` can both hold a handle to the
/// *same* db without a second file open. WAL + the `Mutex` serialise their
/// (sequential, in the CLI) accesses.
#[derive(Clone)]
pub struct SqliteStorage {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteStorage {
    /// Open (creating + migrating if needed) the sqlite file at `path`.
    pub fn open(path: &Path) -> Result<Self, DbError> {
        let conn = db::open(path)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Read the singleton account row. Errors if no account is enrolled
    /// (callers gate on `Profile::require_active` first, so a missing row
    /// means a corrupt/half-written profile).
    pub fn read_account(&self) -> Result<Account, StorageError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let row = conn
            .query_row(
                "SELECT account_id, email, device_id, primary_doc_id FROM account WHERE id = 1",
                [],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Vec<u8>>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(backend)?;
        let (account_id, email, device_id, doc_bytes) =
            row.ok_or_else(|| StorageError::Backend("account row missing".into()))?;
        Ok(Account {
            account_id,
            email,
            device_id,
            primary_doc_id: DocId(uuid_from_slice(&doc_bytes)?),
        })
    }

    /// Upsert the singleton account row.
    pub fn write_account(&self, account: &Account) -> Result<(), StorageError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        conn.execute(
            "INSERT INTO account (id, account_id, email, device_id, primary_doc_id)
             VALUES (1, ?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
               account_id     = excluded.account_id,
               email          = excluded.email,
               device_id      = excluded.device_id,
               primary_doc_id = excluded.primary_doc_id",
            params![
                account.account_id,
                account.email,
                account.device_id,
                account.primary_doc_id.0.as_bytes().to_vec(),
            ],
        )
        .map_err(backend)?;
        Ok(())
    }

    /// Read the per-doc sync cursor. Returns the zero cursor for a doc
    /// with no row yet.
    pub fn read_sync_cursor(&self, doc_id: DocId) -> Result<SyncCursor, StorageError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();
        let row = conn
            .query_row(
                "SELECT last_acked_server_seq, last_sync_at FROM docs WHERE id = ?1",
                [&id],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?)),
            )
            .optional()
            .map_err(backend)?;
        Ok(match row {
            Some((acked, at)) => SyncCursor {
                last_acked_server_seq: ServerSeq(acked as u64),
                last_sync_at: at,
            },
            None => SyncCursor {
                last_acked_server_seq: ServerSeq(0),
                last_sync_at: None,
            },
        })
    }

    /// Persist the observability timestamp only — the "Last sync" shown
    /// by `airday status`. Deliberately separate from the resume cursor:
    /// the engine owns `last_acked_server_seq` (via the `LocalStorage`
    /// trait's `write_acked_seq`), while `last_sync_at` is a CLI-only
    /// stamp nothing in the sync path reads. (Creates the `docs` row if
    /// the first write lands before any op.)
    pub fn write_last_sync_at(&self, doc_id: DocId, at_millis: i64) -> Result<(), StorageError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();
        ensure_doc(&conn, &id)?;
        conn.execute(
            "UPDATE docs SET last_sync_at = ?2 WHERE id = ?1",
            params![id, at_millis],
        )
        .map_err(backend)?;
        Ok(())
    }

    /// Drop the doc cache (ops + snapshot) and reset the sync cursor,
    /// keeping account identity. Backs `airday cache clear`: the next
    /// sync rehydrates from server_seq 0.
    pub fn clear_cache(&self, doc_id: DocId) -> Result<(), StorageError> {
        let mut conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();
        let tx = conn.transaction().map_err(backend)?;
        tx.execute("DELETE FROM ops WHERE doc_id = ?1", [&id])
            .map_err(backend)?;
        tx.execute("DELETE FROM snapshots WHERE doc_id = ?1", [&id])
            .map_err(backend)?;
        tx.execute(
            "UPDATE docs SET last_acked_server_seq = 0, last_sync_at = NULL WHERE id = ?1",
            [&id],
        )
        .map_err(backend)?;
        tx.commit().map_err(backend)?;
        Ok(())
    }
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
        let snap_floor = snapshot.as_ref().map(|s| s.up_to_local_seq.0).unwrap_or(0);

        let replay = {
            let mut stmt = conn
                .prepare(
                    "SELECT local_seq, payload, payload_nonce FROM ops
                     WHERE doc_id = ?1 AND local_seq > ?2 ORDER BY local_seq",
                )
                .map_err(backend)?;
            let rows = stmt
                .query_map(params![id, snap_floor as i64], |r| {
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
        up_to_local_seq: LocalSeq,
        payload: EncryptedBlob,
    ) -> Result<(), StorageError> {
        let mut conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let id = doc_id.0.as_bytes().to_vec();
        let tx = conn.transaction().map_err(backend)?;
        ensure_doc(&tx, &id)?;
        tx.execute(
            "INSERT INTO snapshots
               (doc_id, up_to_local_seq, payload, payload_nonce, created_at)
             VALUES (?1, ?2, ?3, ?4, unixepoch())
             ON CONFLICT(doc_id) DO UPDATE SET
               up_to_local_seq = excluded.up_to_local_seq,
               payload         = excluded.payload,
               payload_nonce   = excluded.payload_nonce,
               created_at      = excluded.created_at",
            params![
                id,
                up_to_local_seq.0 as i64,
                payload.ciphertext,
                payload.nonce,
            ],
        )
        .map_err(backend)?;
        tx.execute(
            "DELETE FROM ops WHERE doc_id = ?1 AND local_seq <= ?2",
            params![id, up_to_local_seq.0 as i64],
        )
        .map_err(backend)?;
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
/// `local_seq` ever assigned for this doc. The snapshot term matters
/// after compaction prunes the rows it folded in: otherwise the next
/// `append_*` would restart `local_seq` at 1 and collide.
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

// ---------- CLI boot / seed / load helpers ----------

#[derive(Debug, thiserror::Error)]
pub enum StorageInitError {
    #[error(transparent)]
    Db(#[from] DbError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Doc(#[from] DocError),
}

/// Open the profile's `SqliteStorage`.
pub fn open_storage(profile: &Profile) -> Result<SqliteStorage, StorageInitError> {
    Ok(SqliteStorage::open(&profile.doc_path())?)
}

/// Reconstruct the live `Doc` from persisted state: load the snapshot
/// (if any) and replay every op past it. `apply_remote_batch` decrypts
/// and imports each blob and advances `last_pushed_vv` to cover them,
/// so the returned doc reports `has_pending_ops() == false` — every
/// stored op is already captured. Returns the doc, the storage's
/// `last_local_seq` (for `SyncEngine::set_last_local_seq`), and the
/// persisted resume cursor `last_acked_server_seq` (for `SyncEngine::new`).
pub fn boot_doc(
    storage: &SqliteStorage,
    dek: &Dek,
    doc_id: DocId,
) -> Result<(Doc, LocalSeq, ServerSeq), StorageInitError> {
    let boot = storage.boot(doc_id)?;
    let mut doc = Doc::empty();
    let mut blobs: Vec<EncryptedBlob> = Vec::with_capacity(1 + boot.replay.len());
    if let Some(snap) = boot.snapshot {
        blobs.push(snap.payload);
    }
    blobs.extend(boot.replay.into_iter().map(|r| r.payload));
    if !blobs.is_empty() {
        doc.apply_remote_batch(dek, blobs.iter())?;
    }
    // Replaying historical state shouldn't surface as live UI changes —
    // drop the AppEvents the import emitted.
    while doc.pop_event().is_some() {}
    Ok((doc, boot.last_local_seq, boot.last_acked_server_seq))
}

/// As `boot_doc`, but discards the cursor — for read-only commands.
pub fn load_doc(
    storage: &SqliteStorage,
    dek: &Dek,
    doc_id: DocId,
) -> Result<Doc, StorageInitError> {
    Ok(boot_doc(storage, dek, doc_id)?.0)
}

/// Write `doc`'s full state as the doc's baseline snapshot
/// (`up_to_local_seq = 0`, prunes nothing). Used at signup / login /
/// recover instead of the old `Profile::write_doc`.
pub fn seed_snapshot(
    storage: &SqliteStorage,
    dek: &Dek,
    doc_id: DocId,
    doc: &Doc,
) -> Result<(), StorageInitError> {
    let blob = doc.snapshot_blob(dek)?;
    storage.write_snapshot(doc_id, LocalSeq(0), blob)?;
    Ok(())
}
