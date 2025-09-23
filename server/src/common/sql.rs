use crate::{
    auth::session::{SessionModel, SessionModelSqlite},
    common::config::AirdayConfig,
    library::{model::LibraryModel, sqlite::LibraryModelSqlite},
    sync::{engine::SyncOpModel, sqlite::SyncOpModelSqlite},
    user::{model::UserModel, sqlite::UserModelSqlite},
};
use crdt::timestamp::{now_micros, seed_clock};
use sqlx::{
    Pool, Sqlite,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use std::{str::FromStr, sync::Arc, time::Duration};

// Provides direct pool access in case we need behaviour conditionally, specific to a db
// #[derive(Clone)]
// pub enum DatabasePool {
//     // Postgres(PgPool), activate l8a
//     Sqlite(SqlitePool),
// }

#[derive(Clone)]
pub struct Db {
    pub library: Arc<dyn LibraryModel>,
    pub user: Arc<dyn UserModel>,
    pub session: Arc<dyn SessionModel>,
    pub sync_op: Arc<dyn SyncOpModel>,
}

impl Db {
    pub fn from_sqlite_pool(pool: Pool<Sqlite>) -> Self {
        Db {
            // pool: DatabasePool::Sqlite(pool.clone()),
            library: Arc::new(LibraryModelSqlite::new(pool.clone())),
            user: Arc::new(UserModelSqlite::new(pool.clone())),
            session: Arc::new(SessionModelSqlite::new(pool.clone())),
            sync_op: Arc::new(SyncOpModelSqlite::new(pool.clone())),
        }
    }
    // fn from_pg_pool(pool: Pool<Pg>) -> Self {
    //     Db {
    //         pool: DatabasePool::Pgpool(pool),
    //     }
    // }
}

pub async fn connect_sqlite(config: &AirdayConfig) -> Db {
    let opts = SqliteConnectOptions::from_str(&config.sqlx_host)
        .unwrap()
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);
    // TODO: Move extension into a local addr
    // .extension("/usr/local/lib/sqlite3/uuid.so");
    let pool_res = SqlitePoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(20))
        .connect_with(opts)
        .await;
    let pool = match pool_res {
        Ok(pool) => pool,
        Err(err) => panic!(
            "Failed to connect to sqlite database, error propagated from sqlx: {}",
            err
        ),
    };
    seed_sqlite_clock_from_db(&pool).await;
    Db::from_sqlite_pool(pool)
}

// This ensures we never go backwards, even on restarts
async fn seed_sqlite_clock_from_db(pool: &Pool<Sqlite>) {
    let db_max =
        sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(server_seq), 0) as db_max FROM item")
            .fetch_one(pool)
            .await
            .unwrap_or(0);
    let utc_now = now_micros();
    let seed = db_max.max(utc_now);
    seed_clock(seed);
    ()
}
