//! Sqlite connection + migration runner.
//!
//! One connection per server for now. `tokio-rusqlite` runs queries on
//! a dedicated background thread, so the runtime is never blocked. WAL
//! mode means we can promote to a pool later without schema changes.

use std::path::Path;

use tokio_rusqlite::Connection;

const MIGRATION_001: &str = include_str!("../migrations/001_init.sql");
const MIGRATION_002: &str = include_str!("../migrations/002_blob_id_rename.sql");

#[derive(Clone)]
pub struct Db {
    conn: Connection,
}

impl Db {
    pub async fn open(path: &Path) -> anyhow::Result<Self> {
        let conn = Connection::open(path).await?;
        let db = Self { conn };
        db.apply_pragmas().await?;
        db.run_migrations().await?;
        Ok(db)
    }

    /// Used by integration tests so we don't litter temp files.
    pub async fn open_in_memory() -> anyhow::Result<Self> {
        let conn = Connection::open_in_memory().await?;
        let db = Self { conn };
        db.apply_pragmas().await?;
        db.run_migrations().await?;
        Ok(db)
    }

    /// Borrow the underlying connection for an arbitrary closure.
    pub async fn call<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&mut rusqlite::Connection) -> rusqlite::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        Ok(self.conn.call(move |c| f(c).map_err(Into::into)).await?)
    }

    async fn apply_pragmas(&self) -> anyhow::Result<()> {
        self.call(|c| {
            // WAL gives us concurrent readers + a single writer without
            // blocking. NORMAL synchrony trades a single fsync per WAL
            // checkpoint for ~10x write throughput; we accept losing
            // the last few seconds of writes on a power-cut crash.
            c.execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA synchronous=NORMAL;
                 PRAGMA busy_timeout=5000;
                 PRAGMA foreign_keys=ON;",
            )
        })
        .await?;
        Ok(())
    }

    async fn run_migrations(&self) -> anyhow::Result<()> {
        self.call(|c| {
            c.execute_batch(
                "CREATE TABLE IF NOT EXISTS _migrations (
                   name        TEXT PRIMARY KEY,
                   applied_at  INTEGER NOT NULL
                 );",
            )
        })
        .await?;

        self.apply_migration("001_init", MIGRATION_001).await?;
        self.apply_blob_id_rename_migration().await?;
        Ok(())
    }

    async fn apply_migration(&self, name: &'static str, sql: &'static str) -> anyhow::Result<()> {
        self.call(move |c| {
            let already = migration_applied(c, name)?;
            if already {
                return Ok(());
            }
            let tx = c.transaction()?;
            tx.execute_batch(sql)?;
            record_migration(&tx, name)?;
            tx.commit()?;
            Ok(())
        })
        .await
    }

    async fn apply_blob_id_rename_migration(&self) -> anyhow::Result<()> {
        const NAME: &str = "002_blob_id_rename";
        self.call(|c| {
            if migration_applied(c, NAME)? {
                return Ok(());
            }

            let devices_new = table_has_column(c, "devices", "last_acked_blob_id")?;
            let ops_new = table_has_column(c, "ops", "blob_id")?;
            let snapshots_new = table_has_column(c, "snapshots", "up_to_blob_id")?
                && table_has_column(c, "snapshots", "shallow_start_blob_id")?;
            if devices_new && ops_new && snapshots_new {
                record_migration(c, NAME)?;
                return Ok(());
            }

            let devices_old = table_has_column(c, "devices", "last_acked_op_id")?;
            let ops_old = table_has_column(c, "ops", "id")?;
            let snapshots_old = table_has_column(c, "snapshots", "up_to_op_id")?
                && table_has_column(c, "snapshots", "shallow_start_op_id")?;
            if !(devices_old && ops_old && snapshots_old) {
                return Err(rusqlite::Error::InvalidQuery);
            }

            let tx = c.transaction()?;
            tx.execute_batch(MIGRATION_002)?;
            record_migration(&tx, NAME)?;
            tx.commit()?;
            Ok(())
        })
        .await
    }
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

fn record_migration(c: &rusqlite::Connection, name: &str) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
        rusqlite::params![name, now_millis()],
    )?;
    Ok(())
}

fn table_has_column(c: &rusqlite::Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = c.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEGACY_SCHEMA: &str = r#"
        CREATE TABLE _migrations (
          name        TEXT PRIMARY KEY,
          applied_at  INTEGER NOT NULL
        );
        CREATE TABLE accounts (
          id                          BLOB PRIMARY KEY,
          email                       TEXT UNIQUE NOT NULL,
          password_hash               BLOB NOT NULL,
          password_salt               BLOB NOT NULL,
          kdf_m_kib                   INTEGER NOT NULL,
          kdf_t                       INTEGER NOT NULL,
          kdf_p                       INTEGER NOT NULL,
          wrapped_dek                 BLOB NOT NULL,
          wrapped_dek_nonce           BLOB NOT NULL,
          recovery_salt               BLOB,
          recovery_auth_hash          BLOB,
          recovery_wrapped_dek        BLOB,
          recovery_wrapped_dek_nonce  BLOB,
          created_at                  INTEGER NOT NULL
        );
        CREATE TABLE devices (
          id                  BLOB PRIMARY KEY,
          account_id          BLOB NOT NULL REFERENCES accounts(id),
          name                TEXT NOT NULL,
          auth_token_hash     BLOB NOT NULL,
          last_acked_op_id    INTEGER NOT NULL DEFAULT 0,
          last_seen_at        INTEGER NOT NULL,
          created_at          INTEGER NOT NULL
        );
        CREATE INDEX devices_account_id_idx ON devices (account_id);
        CREATE INDEX devices_token_hash_idx ON devices (auth_token_hash);
        CREATE TABLE ops (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id      BLOB NOT NULL REFERENCES accounts(id),
          payload         BLOB NOT NULL,
          payload_nonce   BLOB NOT NULL,
          created_at      INTEGER NOT NULL
        );
        CREATE INDEX ops_account_id_idx ON ops (account_id, id);
        CREATE TABLE snapshots (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id            BLOB NOT NULL REFERENCES accounts(id),
          up_to_op_id           INTEGER NOT NULL,
          shallow_start_op_id   INTEGER NOT NULL,
          payload               BLOB NOT NULL,
          payload_nonce         BLOB NOT NULL,
          created_at            INTEGER NOT NULL
        );
        CREATE INDEX snapshots_account_id_idx ON snapshots (account_id, id DESC);
    "#;

    #[tokio::test]
    async fn blob_id_migration_rebuilds_legacy_schema() {
        let conn = Connection::open_in_memory().await.unwrap();
        let db = Db { conn };
        db.call(|c| c.execute_batch(LEGACY_SCHEMA)).await.unwrap();

        db.call(|c| {
            c.execute(
                "INSERT INTO accounts (
                   id, email, password_hash, password_salt, kdf_m_kib, kdf_t, kdf_p,
                   wrapped_dek, wrapped_dek_nonce, recovery_salt, recovery_auth_hash,
                   recovery_wrapped_dek, recovery_wrapped_dek_nonce, created_at
                 ) VALUES (?1, 'u@example.com', x'00', x'00', 8, 1, 1, x'00', x'00', NULL, NULL, NULL, NULL, 1)",
                [vec![1u8; 16]],
            )?;
            c.execute(
                "INSERT INTO devices (id, account_id, name, auth_token_hash, last_acked_op_id, last_seen_at, created_at)
                 VALUES (?1, ?2, 'dev', x'01', 7, 1, 1)",
                rusqlite::params![vec![2u8; 16], vec![1u8; 16]],
            )?;
            c.execute(
                "INSERT INTO ops (id, account_id, payload, payload_nonce, created_at)
                 VALUES (11, ?1, x'aa', x'bb', 1)",
                [vec![1u8; 16]],
            )?;
            c.execute(
                "INSERT INTO snapshots (id, account_id, up_to_op_id, shallow_start_op_id, payload, payload_nonce, created_at)
                 VALUES (5, ?1, 11, 7, x'cc', x'dd', 1)",
                [vec![1u8; 16]],
            )?;
            Ok(())
        })
        .await
        .unwrap();

        db.apply_blob_id_rename_migration().await.unwrap();

        db.call(|c| {
            assert!(table_has_column(c, "devices", "last_acked_blob_id")?);
            assert!(table_has_column(c, "ops", "blob_id")?);
            assert!(table_has_column(c, "snapshots", "up_to_blob_id")?);
            assert!(migration_applied(c, "002_blob_id_rename")?);

            let last_acked: i64 =
                c.query_row("SELECT last_acked_blob_id FROM devices", [], |r| r.get(0))?;
            let blob_id: i64 = c.query_row("SELECT blob_id FROM ops", [], |r| r.get(0))?;
            let snapshot: (i64, i64) = c.query_row(
                "SELECT up_to_blob_id, shallow_start_blob_id FROM snapshots",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            assert_eq!(last_acked, 7);
            assert_eq!(blob_id, 11);
            assert_eq!(snapshot, (11, 7));
            Ok(())
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn blob_id_migration_marks_already_renamed_schema() {
        let conn = Connection::open_in_memory().await.unwrap();
        let db = Db { conn };
        db.call(|c| {
            c.execute_batch(
                "CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);",
            )
        })
        .await
        .unwrap();
        db.call(|c| c.execute_batch(MIGRATION_001)).await.unwrap();

        db.apply_blob_id_rename_migration().await.unwrap();

        db.call(|c| {
            assert!(migration_applied(c, "002_blob_id_rename")?);
            Ok(())
        })
        .await
        .unwrap();
    }
}
