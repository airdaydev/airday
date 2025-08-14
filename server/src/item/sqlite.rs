use std::pin::Pin;

use async_trait::async_trait;
use chrono::NaiveDateTime;
use sqlx::{Sqlite, SqlitePool, Transaction};
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

async fn insert<'a>(tx: &mut Transaction<'a, Sqlite>, item: &Item) -> Result<(), AppError> {
    let attributes_json = convert_item_attributes_to_json(&item.attributes)?;
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
    .execute(tx.as_mut())
    .await?;
    Ok(())
}

async fn merge<'a>(tx: &mut Transaction<'a, Sqlite>, item: &Item) -> Result<(), AppError> {
    // Select for merge
    let result = sqlx::query_as!(
        SqlItem,
        r#"SELECT id as "id: Uuid", library_id as "library_id: Uuid",
        updated_utc, tombstone_utc, attributes as "attributes: JsonAttributes"
        FROM item
        WHERE library_id = ? AND id = ?"#,
        item.library_id,
        item.id,
    )
    .fetch_optional(tx.as_mut())
    .await?;
    // 2. Check if item exists
    let Some(sql_item) = result else {
        // Item does not exist, insert new item
        insert(tx, item).await?;
        return Ok(());
    };
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
    .execute(tx.as_mut())
    .await?;
    Ok(())
}

#[async_trait]
impl ItemModel for ItemModelSqlite {
    async fn merge_many(&self, item: &Vec<Item>) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await?;
        for item in item {
            merge(&mut tx, item).await?;
        }
        tx.commit().await?;
        Ok(())
    }
    // TODO: Performance testing, w sqlite consider repeated smaller calls for use in stream
    fn get_by_library_stream<'a>(
        &'a self,
        library_id: &Uuid,
        server_timestamp: u64,
    ) -> Pin<
        Box<dyn futures_util::Stream<Item = Result<SqlItem, sqlx::Error>> + std::marker::Send + 'a>,
    > {
        sqlx::query_as::<_, SqlItem>(
            r#"SELECT id, library_id, updated_utc, tombstone_utc, attributes
            FROM item
            WHERE library_id = ? AND updated_utc >= ?
            ORDER BY updated_utc ASC"#,
        )
        .bind(library_id.clone())
        .bind(server_timestamp as i64)
        .fetch(&self.pool)
    }
}

#[cfg(test)]
mod tests {
    use crate::test_util::{self, mock_item};
    use futures_util::StreamExt;

    #[tokio::test]
    async fn test_get_by_library_stream() {
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("test@test.com")).await;
        let primary_library_id = user.primary_library.unwrap().id;
        let qty = 10;
        let mut items = vec![];
        for _ in 0..qty {
            items.push(mock_item(primary_library_id))
        }
        db.item.merge_many(&items).await.unwrap();
        let mut stream = db.item.get_by_library_stream(&primary_library_id, 0u64);
        let mut count = 0;
        while let Some(result) = stream.next().await {
            match result {
                Ok(_item) => count += 1,
                Err(e) => panic!("Stream error: {}", e),
            }
        }

        assert_eq!(count, qty);
    }
}
