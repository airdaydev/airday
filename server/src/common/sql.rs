use std::{str::FromStr, time::Duration};

use sqlx::{
    Pool, Sqlite,
    sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions},
};

use crate::common::config::AirdayConfig;

pub async fn connect_sqlite(config: &AirdayConfig) -> Pool<Sqlite> {
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
    pool
}
