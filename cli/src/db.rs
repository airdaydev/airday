//! Per-profile sqlite for local doc storage.
//!
//! One database file per profile, opened lazily by `Profile`. The
//! schema today is a single-row `doc_snapshot` blob — a drop-in for the
//! old `loro.bin` file. The Storage trait work will replace this with
//! a WAL + snapshot layout shared with the web client.

use std::path::Path;

use tokio_rusqlite::Connection;

const MIGRATION_001: &str = include_str!("../migrations/001_init.sql");

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] tokio_rusqlite::Error),
}

pub async fn open(path: &Path) -> Result<Connection, DbError> {
    let conn = Connection::open(path).await?;
    apply_pragmas(&conn).await?;
    run_migrations(&conn).await?;
    Ok(conn)
}

async fn apply_pragmas(conn: &Connection) -> Result<(), DbError> {
    conn.call(|c| {
        c.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             PRAGMA foreign_keys=ON;",
        )?;
        Ok(())
    })
    .await?;
    Ok(())
}

async fn run_migrations(conn: &Connection) -> Result<(), DbError> {
    conn.call(|c| {
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
               name        TEXT PRIMARY KEY,
               applied_at  INTEGER NOT NULL
             );",
        )?;
        apply_migration(c, "001_init", MIGRATION_001)?;
        Ok(())
    })
    .await?;
    Ok(())
}

fn apply_migration(c: &mut rusqlite::Connection, name: &str, sql: &str) -> rusqlite::Result<()> {
    if migration_applied(c, name)? {
        return Ok(());
    }
    let tx = c.transaction()?;
    tx.execute_batch(sql)?;
    tx.execute(
        "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
        rusqlite::params![name, now_millis()],
    )?;
    tx.commit()?;
    Ok(())
}

fn migration_applied(c: &rusqlite::Connection, name: &str) -> rusqlite::Result<bool> {
    c.query_row("SELECT 1 FROM _migrations WHERE name = ?", [name], |r| {
        r.get::<_, i64>(0)
    })
    .map(|_| true)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        other => Err(other),
    })
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
