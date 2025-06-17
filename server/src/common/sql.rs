use std::str::FromStr;

use sqlx::{
    Pool, Sqlite,
    sqlite::{SqliteConnectOptions, SqlitePool},
};

use crate::common::config::AirdayConfig;

pub async fn connect_sqlite(config: &AirdayConfig) -> Pool<Sqlite> {
    let opts = SqliteConnectOptions::from_str(&config.sqlx_host).unwrap();
    // .extension("/usr/local/lib/sqlite3/uuid.so");
    // TODO: Move extension into a local addr
    let pool_res = SqlitePool::connect_with(opts).await;
    let pool = match pool_res {
        Ok(pool) => pool,
        Err(err) => panic!(
            "Failed to connect to sqlite database, error propagated from sqlx: {}",
            err
        ),
    };
    pool
}
