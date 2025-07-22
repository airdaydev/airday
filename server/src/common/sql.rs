use crate::{
    common::config::AirdayConfig,
    model::{
        item::{ItemModel, ItemModelSqlite},
        session::{SessionModel, SessionModelSqlite},
    },
    user::{model::UserModel, sqlite::UserModelSqlite},
    workspace::{model::WorkspaceModel, sqlite::WorkspaceModelSqlite},
};
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
    pub workspaces: Arc<dyn WorkspaceModel>,
    pub user: Arc<dyn UserModel>,
    pub session: Arc<dyn SessionModel>,
    pub item: Arc<dyn ItemModel>,
}

impl Db {
    pub fn from_sqlite_pool(pool: Pool<Sqlite>) -> Self {
        Db {
            // pool: DatabasePool::Sqlite(pool.clone()),
            workspaces: Arc::new(WorkspaceModelSqlite::new(pool.clone())),
            user: Arc::new(UserModelSqlite::new(pool.clone())),
            session: Arc::new(SessionModelSqlite::new(pool.clone())),
            item: Arc::new(ItemModelSqlite::new(pool.clone())),
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
