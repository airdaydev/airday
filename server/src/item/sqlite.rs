use std::pin::Pin;

use async_trait::async_trait;
use chrono::NaiveDateTime;
use futures_util::{Stream, StreamExt};
use sqlx::{Sqlite, SqlitePool, Transaction, sqlite::SqliteRow};
use uuid::Uuid;

use crate::{
    common::error::AppError,
    item::model::{
        Item, ItemAttributes, ItemAttributesJson, ItemModel, JsonAttributes, SqlItem,
        convert_item_attributes_to_json,
    },
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
    async fn merge(&self, item: &Item) -> Result<(), AppError> {
        // 1. Select (we could grab multiple l8a?)
        let mut tx = self.pool.begin().await.map_err(|err| AppError::from(err))?;
        let result = sqlx::query_as!(
            SqlItem,
            r#"SELECT id as "id: Uuid", library_id as "library_id: Uuid",
            updated_utc, tombstone_utc, attributes as "attributes: JsonAttributes" FROM item
            WHERE library_id = ? AND id = ?"#,
            item.library_id,
            item.id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|err| AppError::from(err))?;
        // 2. Check if item exists
        if let Some(sql_item) = result {
            if let Some(_) = sql_item.tombstone_utc {
                // Item is tombstones - discard changes
                // TODO: The user SHOULD not encounter this, and if they do, be informed of it.
                return Err(AppError::ValidationError(String::from(
                    "item is tombstoned",
                )));
            }
            // Get existing attributes
            // TODO: How to handle parsing error...? Parsing must be VERY robust
            let mut src_attrs: ItemAttributes = sql_item
                .attributes
                .as_ref()
                .and_then(|json| serde_json::from_value::<ItemAttributesJson>(json.clone()).ok())
                .map(ItemAttributes::from)
                .unwrap();
            println!("existing_attrs {:?}", src_attrs);
            src_attrs.merge(&item.attributes);

            // Update!
            let updated_attributes_json = convert_item_attributes_to_json(&src_attrs)?;
            let now = chrono::Utc::now().naive_utc();

            sqlx::query!(
                r#"UPDATE item
                 SET attributes = ?, updated_utc = ?
                 WHERE id = ? AND library_id = ? AND tombstone_utc IS NULL"#,
                updated_attributes_json,
                now,
                item.id,
                item.library_id
            )
            .execute(&mut *tx)
            .await
            .map_err(|err| AppError::from(err))?;

            tx.commit().await.map_err(|err| AppError::from(err))?;
            println!("merged_attrs {:?}", src_attrs);
            return Ok(());
        } else {
            // Item does not exist, insert new item
            let _ = self.insert(item).await.unwrap();
            Ok(())
        }
    }
    async fn insert(&self, item: &Item) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await.map_err(|err| AppError::from(err))?;

        // Convert ItemAttributes to JsonAttributes
        let attributes_json = convert_item_attributes_to_json(&item.attributes)?;

        // Insert the item with current timestamp
        let now = chrono::Utc::now().naive_utc();

        sqlx::query!(
            r#"INSERT INTO item (id, library_id, attributes, updated_utc, tombstone_utc)
               VALUES (?, ?, ?, ?, ?)"#,
            item.id,
            item.library_id,
            attributes_json,
            now,
            Option::<NaiveDateTime>::None
        )
        .execute(&mut *tx)
        .await
        .map_err(|err| AppError::from(err))?;

        tx.commit().await.map_err(|err| AppError::from(err))?;

        Ok(())
    }
    async fn get_by_library(
        &self,
        // library: &Uuid,
    ) -> Pin<Box<dyn Stream<Item = Result<SqliteRow, AppError>> + Send>> {
        let stream = sqlx::query_as!(Item, r#""#).fetch(&self.pool);
        let mapped_stream = stream.map(|result| result.map_err(|err| AppError::from(err)));
        Box::pin(mapped_stream)
    }
}
