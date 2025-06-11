use sqlx::{Pool, Sqlite, sqlite::SqlitePool};

use crate::config::AirdayConfig;

pub async fn connect_sqlite(config: &AirdayConfig) -> Pool<Sqlite> {
    let pool_res = SqlitePool::connect(&config.sqlx_host).await;
    let pool = match pool_res {
        Ok(pool) => pool,
        Err(err) => panic!(
            "Failed to connect to sqlite database, error propagated from sqlx: {}",
            err
        ),
    };
    pool
}
