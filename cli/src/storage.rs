//! CLI local persistence.
//!
//! `SqliteStorage` is the native `LocalStorage` implementation: plain
//! `rusqlite` behind a `Mutex`, synchronously durable (the trait method
//! returns only after the `INSERT`/`UPDATE` commits). The schema is
//! `cli/migrations/002_local_storage.sql` — an append-only `ops` log
//! plus one `snapshots` row per doc.
//!
//! The free functions at the bottom (`boot_doc`, `seed_snapshot`,
//! `load_doc`) turn the trait into a live `Doc`: they hold the DEK and
//! handle seal/open, so the trait itself stays key-agnostic (it only
//! ever sees opaque `EncryptedBlob`s).

use std::path::Path;
use std::sync::Mutex;

use airday_core::{
    BootState, ClientOpId, Dek, Doc, DocError, DocId, LocalOpRow, LocalSeq, LocalStorage,
    OutboxRow, RemoteOpRow, ReplayRow, ServerSeq, SnapshotRow, StorageError,
};
use airday_protocol::EncryptedBlob;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::config::Profile;
use crate::db::{self, DbError};

const LEGACY_DOC_FILE: &str = "loro.bin";

/// Native `LocalStorage` over a per-profile sqlite file.
pub struct SqliteStorage {
    conn: Mutex<Connection>,
}

impl SqliteStorage {
    /// Open (creating + migrating if needed) the sqlite file at `path`.
    pub fn open(path: &Path) -> Result<Self, DbError> {
        let conn = db::open(path)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// The old `001_init` doc blob, preserved by migration `002` as
    /// `docs_legacy_v1` — an unencrypted `Doc::save()` envelope, if a
    /// pre-migration profile is being opened. `None` once the table has
    /// been drained and dropped (`drop_legacy_doc`).
    pub fn legacy_doc_payload(&self) -> Result<Option<Vec<u8>>, DbError> {
        let conn = self.conn.lock().expect("SqliteStorage mutex poisoned");
        let exists = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='docs_legacy_v1'",
                [],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            return Ok(None);
        }
        let payload = conn
            .query_row("SELECT payload FROM docs_legacy_v1 LIMIT 1", [], |r| {
                r.get::<_, Vec<u8>>(0)
            })
            .optional()?;
        Ok(payload)
    }

    /// Drop the legacy table once its contents have been migrated.
    pub fn drop_legacy_doc(&self) -> Result<(), DbError> {
        self.conn
            .lock()
            .expect("SqliteStorage mutex poisoned")
            .execute("DROP TABLE IF EXISTS docs_legacy_v1", [])?;
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
        let last_acked: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(server_seq), 0) FROM ops WHERE doc_id = ?1",
                [&id],
                |r| r.get(0),
            )
            .map_err(backend)?;

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

/// Open the profile's `SqliteStorage`, nuking any stray legacy
/// `loro.bin` blob from pre-sqlite builds first.
pub fn open_storage(profile: &Profile) -> Result<SqliteStorage, StorageInitError> {
    let legacy = profile.dir.join(LEGACY_DOC_FILE);
    if legacy.exists() {
        let _ = std::fs::remove_file(&legacy);
    }
    Ok(SqliteStorage::open(&profile.doc_path())?)
}

/// Reconstruct the live `Doc` from persisted state: load the snapshot
/// (if any) and replay every op past it. `apply_remote_batch` decrypts
/// and imports each blob and advances `last_pushed_vv` to cover them,
/// so the returned doc reports `has_pending_ops() == false` — every
/// stored op is already captured. Returns the doc plus the storage's
/// `last_local_seq` (for `SyncEngine::set_last_local_seq`).
pub fn boot_doc(
    storage: &SqliteStorage,
    dek: &Dek,
    doc_id: DocId,
) -> Result<(Doc, LocalSeq), StorageInitError> {
    drain_legacy_doc(storage, dek, doc_id)?;

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
    Ok((doc, boot.last_local_seq))
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

/// One-shot migration: if a pre-002 `docs_legacy_v1` blob survives,
/// load its plaintext envelope, seal it as the baseline snapshot, and
/// drop the table. No-op on already-migrated profiles.
fn drain_legacy_doc(
    storage: &SqliteStorage,
    dek: &Dek,
    doc_id: DocId,
) -> Result<(), StorageInitError> {
    if let Some(bytes) = storage.legacy_doc_payload()? {
        let doc = Doc::load(&bytes)?;
        seed_snapshot(storage, dek, doc_id, &doc)?;
    }
    storage.drop_legacy_doc()?;
    Ok(())
}
