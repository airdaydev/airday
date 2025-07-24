use std::pin::Pin;

use async_trait::async_trait;
use futures_util::{Stream, StreamExt};
use sqlx::{SqlitePool, sqlite::SqliteRow};
use uuid::Uuid;

use crate::{
    common::error::AppError,
    item::model::{Item, ItemAttributesJson, ItemModel, JsonAttributes, SqlItem},
};

pub struct ItemModelSqlite {
    pool: SqlitePool,
}

impl ItemModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ItemModel for ItemModelSqlite {
    // TODO: Break this into parts
    async fn merge(&self, workspace_id: &Uuid, item: &Item) -> Result<(), AppError> {
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
        if let Some(mut sql_item) = result {
            if let Some(tombstone) = sql_item.tombstone_utc {
                // BLACKHOLE
                // TODO: Consider usage pattern to determine type - we would usually want to give the user back this info
                return Err(AppError::ValidationError(String::from(
                    "item is tombstoned",
                )));
            }
            let _attrs: ItemAttributesJson = sql_item
                .attributes
                .as_ref()
                .and_then(|json| serde_json::from_value(json.clone()).ok())
                .unwrap();
            // attrs.merge(item);
            // TODO: Evaluate and merge here i.e. turn each attribute into a valid LWWRegister
            // then merge with item above
            return Ok(());
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
