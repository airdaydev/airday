use std::pin::Pin;

use crate::common::error::AppError;
use async_trait::async_trait;
use chrono::NaiveDateTime;
use futures_util::{Stream, StreamExt, TryStreamExt};
use lww_rs::LWWRegisterString;
use serde::{Deserialize, Serialize};
use sqlx::{Error, SqlitePool, Transaction, error::DatabaseError, sqlite::SqliteRow, types::Json};
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
struct LWWDefinitionJson<T> {
    utc: i64,
    pid: i64,
    data: T,
}

struct ItemAttributes {
    text: Option<LWWRegisterString>,
}

// Should serialize/deserialize to this
#[derive(sqlx::FromRow, Deserialize, Serialize)]
struct ItemAttributesJson {
    text: Option<LWWDefinitionJson<String>>,
}

impl ItemAttributesJson {
    fn merge(&self, other: &ItemAttributesJson) {
        // Merging text
        if let Some(text) = &other.text {
            // case 1: attr doesn't exist on self, replace
            // case 2: attr does exist, merge via app logic
        }
        // TODO: Repeat for each attribute
    }
}

type JsonAttributes = Option<serde_json::Value>;

pub struct SqlItem {
    // static attrs
    pub id: Uuid,
    pub workspace_id: Uuid,
    // dynamic attrs (lww-map)
    pub attributes: JsonAttributes,
    // metadata
    pub updated_utc: NaiveDateTime,
    pub tombstone_utc: Option<NaiveDateTime>,
}

// TODO: Implement Item * Item from SqlItem (Maybe?)
// pub struct Item {
//     pub id: Uuid,
//     pub workspace_id: Uuid,
//     pub text: Option<LWWRegisterString>,
// }

// impl From<SqlItem> for Item {
//     fn from(sql_item: SqlItem) -> Self {
//         Self {
//             id: sql_item.id,
//             // TODO: back and forth between json type
//             // text: LWWRegisterString::from_string(String::from("Test")),
//         }
//     }
// }

#[async_trait]
pub trait UserModel: Send + Sync {
    // Accept query options
    async fn get_by_workspace(
        &self,
        // workspace: &Uuid,
    ) -> Pin<Box<dyn Stream<Item = Result<SqliteRow, AppError>> + Send>>;
    async fn merge(&self, workspace_id: &Uuid, item: &SqlItem) -> Result<SqlItem, AppError>;
    // async fn get_by_id(&self, id: &Uuid) -> Result<Option<Item>, AppError>;
}

pub struct ItemModelSqlite {
    pool: SqlitePool,
}

#[async_trait]
impl UserModel for ItemModelSqlite {
    // TODO: Break this into parts
    async fn merge(&self, workspace_id: &Uuid, item: &SqlItem) -> Result<SqlItem, AppError> {
        // Start trx, read, merge, end trx
        // let tx = sqlx::SqliteTransaction;
        let mut tx = self.pool.begin().await.map_err(|err| AppError::from(err))?;
        let result = sqlx::query_as!(
            SqlItem,
            r#"SELECT id as "id: Uuid", workspace_id as "workspace_id: Uuid",
            updated_utc, tombstone_utc, attributes as "attributes: JsonAttributes" FROM item
            WHERE workspace_id = ? AND id = ?"#,
            workspace_id,
            item.id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| AppError::from(err))?;
        if let Some(tombstone) = item.tombstone_utc {
            // BLACKHOLE
            // TODO: Consider usage pattern to determine type - we would usually want to give the user back this info
            return Err(AppError::ValidationError(String::from(
                "item is tombstoned",
            )));
        }
        if let Some(mut sql_item) = result {
            sql_item.attributes = sql_item
                .attributes
                .as_ref()
                .and_then(|json| serde_json::from_value(json.clone()).ok());
            // TODO: Evaluate and merge here i.e. turn each attribute into a valid LWWRegister
            // then merge with item above
            return Ok(sql_item);
        } else {
            // TODO: This is where we insert a new item
            Err(AppError::ServerError(String::from("Not yet implemented")))
        }
    }
    async fn get_by_workspace(
        &self,
        // workspace: &Uuid,
    ) -> Pin<Box<dyn Stream<Item = Result<SqliteRow, AppError>> + Send>> {
        let stream = sqlx::query_as!(Item, r#""#).fetch(&self.pool);
        let mapped_stream = stream.map(|result| result.map_err(|err| AppError::from(err)));
        Box::pin(mapped_stream)
    }
}
