//! Per-profile sqlite for local doc storage.
//!
//! One database file per profile (`loro.sqlite`). Opens synchronously and
//! runs the migration ledger; the `LocalStorage` trait
//! (`crate::storage::SqliteStorage`) drives every read/write on top of
//! the connection. The trait is synchronous (`&self`), so this uses
//! plain `rusqlite` — not `tokio-rusqlite` — wrapped behind a `Mutex`
//! by `SqliteStorage`.

use std::path::Path;

use rusqlite::{params, Connection};

const MIGRATION_001: &str = include_str!("../migrations/001_init.sql");

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub fn open(path: &Path) -> Result<Connection, DbError> {
    let mut conn = Connection::open(path)?;
    apply_pragmas(&conn)?;
    run_migrations(&mut conn)?;
    Ok(conn)
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

fn run_migrations(conn: &mut Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
           name        TEXT PRIMARY KEY,
           applied_at  INTEGER NOT NULL
         );",
    )?;
    apply_migration(conn, "001_init", MIGRATION_001)?;
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
