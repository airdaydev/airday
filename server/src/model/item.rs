use std::pin::Pin;

use crate::common::error::AppError;
use async_trait::async_trait;
use chrono::NaiveDateTime;
use futures_util::{Stream, StreamExt, TryStreamExt};
use lww_rs::LWWRegisterString;
use sqlx::{Error, SqlitePool, error::DatabaseError, sqlite::SqliteRow, types::Json};
use uuid::Uuid;

struct SqlLWWDefinition<T> {
    utc: i64,
    pid: i64,
    data: T,
}

// Should serialize/deserialize to this
#[derive(sqlx::FromRow)]
struct SqlItemAttributes {
    text: Option<SqlLWWDefinition<String>>,
}

struct SqlItem {
    // static attrs
    id: Uuid,
    workspace_id: Uuid,
    // dynamic attrs (lww-map)
    pub attributes: Json<SqlItemAttributes>,
    // metadata
    updated_utc: NaiveDateTime,
    tombstone_utc: NaiveDateTime,
}

// TODO: Implement Item from SqlItem
// TODO: Define LWWStringRegister
struct Item {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub text: Option<LWWRegisterString>,
}

impl From<SqlItem> for Item {
    fn from(sql_item: SqlItem) -> Self {
        Self {
            id: sql_item.id,
            // TODO: back and forth between json type
            // text: LWWRegisterString::from_string(String::from("Test")),
        }
    }
}

#[async_trait]
pub trait UserModel: Send + Sync {
    // Accept query options
    async fn get_by_workspace(
        &self,
        // workspace: &Uuid,
    ) -> Pin<Box<dyn Stream<Item = Result<SqliteRow, AppError>> + Send>>;
    async fn merge(&self, workspace_id: &Uuid, item: &SqlItem) -> Result<Item, AppError>;
    // async fn get_by_id(&self, id: &Uuid) -> Result<Option<Item>, AppError>;
}

pub struct ItemModelSqlite {
    pool: SqlitePool,
}

#[async_trait]
impl UserModel for ItemModelSqlite {
    async fn merge(&self, workspace_id: &Uuid, item: &SqlItem) -> Result<SqlItem, AppError> {
        // Start trx, read, merge, end trx
        // let tx = sqlx::SqliteTransaction;
        let select = sqlx::query_as!(
            SqlItem,
            r#"SELECT id as "id: Uuid", updated_utc, tombstone_utc, attributes FROM item WHERE workspace_id = ? AND id = ?"#,
            workspace_id,
            item.id,
        )
        .fetch_optional(&self.pool)
        .await;
        // 1: get item
    }
    async fn get_by_workspace(
        &self,
        // workspace: &Uuid,
    ) -> Pin<Box<dyn Stream<Item = Result<SqliteRow, AppError>> + Send>> {
        let stream = sqlx::query_as!(Item, r#""#).fetch(&self.pool);
        let mapped_stream =
            stream.map(|result| result.map_err(|e| AppError::DatabaseError(e.to_string())));
        Box::pin(mapped_stream)
    }
}
