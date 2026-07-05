//! CLI local persistence.
//!
//! The generic doc storage — the `ops` / `snapshots` log and the
//! `LocalStorage` trait impl — now lives in `airday-storage-sqlite` so
//! the FFI / native app builds can share it. This module is the thin
//! CLI-specific layer on top: it adds the singleton `account` identity
//! row and the per-doc sync-cursor columns to the *same* db file, and
//! re-exports the DEK-holding boot/seed/load glue (which lives beside the
//! `LocalStorage` trait in `airday-core`).
//!
//! `SqliteStorage` here is a newtype over the shared backend. It carries
//! the CLI's inherent account/cursor queries (which reach the shared
//! connection directly) and forwards the `LocalStorage` trait to the
//! backend, so the engine and every command keep the same API they had
//! when this type was defined in-crate.

use std::sync::Arc;
use std::sync::Mutex;

use airday_core::{
    BootState, ClientOpId, DocId, LocalOpRow, LocalSeq, LocalStorage, OutboxRow, RemoteOpRow,
    ServerSeq, SnapshotCutoff, StorageError,
};
use airday_protocol::EncryptedBlob;
use airday_storage_sqlite::SqliteStorage as SqliteBackend;
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

use crate::config::Profile;

pub use airday_core::{BootError, boot_doc, load_doc, seed_snapshot};
pub use airday_storage_sqlite::DbError;

/// Ledger name for the CLI's extra migration (`cli/migrations/001_init.sql`).
/// Distinct from the storage crate's own `"001_init"` so both can live in
/// the one shared `_migrations` table without colliding.
const CLI_MIGRATION_NAME: &str = "001_cli";
const CLI_MIGRATION_SQL: &str = include_str!("../migrations/001_init.sql");

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

/// Native `LocalStorage` over a per-profile sqlite file — a CLI newtype
/// around the shared [`SqliteBackend`].
///
/// `Clone` is shallow: clones share one connection (see the backend's
/// `Clone`), so the engine and the owning `Session` can both hold a
/// handle to the *same* db without a second file open.
#[derive(Clone)]
pub struct SqliteStorage(SqliteBackend);

impl SqliteStorage {
    /// Open (creating + migrating if needed) the sqlite file at `path`,
    /// applying the shared doc-storage schema plus the CLI's `account`
    /// table.
    pub fn open(path: &std::path::Path) -> Result<Self, DbError> {
        let backend =
            SqliteBackend::open_with_extra(path, &[(CLI_MIGRATION_NAME, CLI_MIGRATION_SQL)])?;
        Ok(Self(backend))
    }

    /// The shared connection, for the CLI's own (non-doc) queries.
    fn conn(&self) -> &Arc<Mutex<Connection>> {
        self.0.connection()
    }

    /// Read the singleton account row. Errors if no account is enrolled
    /// (callers gate on `Profile::require_active` first, so a missing row
    /// means a corrupt/half-written profile).
    pub fn read_account(&self) -> Result<Account, StorageError> {
        let conn = self.conn().lock().expect("SqliteStorage mutex poisoned");
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
        let conn = self.conn().lock().expect("SqliteStorage mutex poisoned");
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
        let conn = self.conn().lock().expect("SqliteStorage mutex poisoned");
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
        let conn = self.conn().lock().expect("SqliteStorage mutex poisoned");
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
        let mut conn = self.conn().lock().expect("SqliteStorage mutex poisoned");
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

/// Forward the whole `LocalStorage` trait to the shared backend — the
/// engine only ever sees the trait, so the newtype is transparent to it.
impl LocalStorage for SqliteStorage {
    fn boot(&self, doc_id: DocId) -> Result<BootState, StorageError> {
        self.0.boot(doc_id)
    }
    fn append_local_op(&self, doc_id: DocId, row: LocalOpRow) -> Result<LocalSeq, StorageError> {
        self.0.append_local_op(doc_id, row)
    }
    fn append_remote_op(&self, doc_id: DocId, row: RemoteOpRow) -> Result<LocalSeq, StorageError> {
        self.0.append_remote_op(doc_id, row)
    }
    fn ack_local_op(
        &self,
        doc_id: DocId,
        client_op_id: ClientOpId,
        server_seq: ServerSeq,
    ) -> Result<(), StorageError> {
        self.0.ack_local_op(doc_id, client_op_id, server_seq)
    }
    fn outbox(&self, doc_id: DocId) -> Result<Vec<OutboxRow>, StorageError> {
        self.0.outbox(doc_id)
    }
    fn write_snapshot(
        &self,
        doc_id: DocId,
        cutoff: SnapshotCutoff,
        payload: EncryptedBlob,
    ) -> Result<(), StorageError> {
        self.0.write_snapshot(doc_id, cutoff, payload)
    }
    fn write_acked_seq(&self, doc_id: DocId, seq: ServerSeq) -> Result<(), StorageError> {
        self.0.write_acked_seq(doc_id, seq)
    }
}

fn backend(e: rusqlite::Error) -> StorageError {
    StorageError::Backend(e.to_string())
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

/// Open the profile's `SqliteStorage`.
pub fn open_storage(profile: &Profile) -> Result<SqliteStorage, DbError> {
    SqliteStorage::open(&profile.doc_path())
}
