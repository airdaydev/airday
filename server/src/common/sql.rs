use crate::{
    common::config::AirdayConfig,
    model::workspace::{SqliteWorkspace, WorkspaceModel},
};
use sqlx::{
    Pool, Sqlite,
    sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions},
};
use std::{str::FromStr, sync::Arc, time::Duration};

// Provides direct pool access in case we need behaviour conditionally, specific to a db
#[derive(Clone)]
pub enum DatabasePool {
    // Postgres(PgPool), activate l8a
    Sqlite(SqlitePool),
}

#[derive(Clone)]
pub struct Db {
    pub pool: DatabasePool,
    pub workspaces: Arc<dyn WorkspaceModel>,
}

impl Db {
    fn from_sqlite_pool(pool: Pool<Sqlite>) -> Self {
        Db {
            pool: DatabasePool::Sqlite(pool.clone()),
            workspaces: Arc::new(SqliteWorkspace::new(pool.clone())),
        }
    }
    // fn from_pg_pool(pool: Pool<Pg>) -> Self {
    //     Db {
    //         pool: DatabasePool::Pgpool(pool),
    //     }
    // }
}

pub async fn connect_sqlite(config: &AirdayConfig) -> Db {
    let opts = SqliteConnectOptions::from_str(&config.sqlx_host).unwrap();
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
    Db::from_sqlite_pool(pool)
}
