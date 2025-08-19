use async_trait::async_trait;
use crdt::timestamp::now_micros;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::pin::Pin;
use tracing::debug;
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

async fn insert<'a>(tx: &mut Transaction<'a, Sqlite>, item: &Item) -> Result<i64, AppError> {
    let attributes_json = convert_item_attributes_to_json(&item.attributes)?;
    let server_seq = now_micros();
    sqlx::query!(
        r#"INSERT INTO item (id, library_id, attributes, server_seq, tombstone_utc)
           VALUES (?, ?, ?, ?, ?)"#,
        item.id,
        item.library_id,
        attributes_json,
        server_seq,
        Option::<i64>::None
    )
    .execute(tx.as_mut())
    .await?;
    Ok(server_seq)
}

// TODO: Potentially optimise this for speed by consolidating into one select statements by library
// But note, retries must still be selected individually
// nb. the sqlite version is single server, but monotonic server_seq across threads
// If 2 threads read from the same data, at same clock time (but different real time)
// This could result in both clients merging into the same read data
// However, only one writer will succeed, as the writer must match the server_seq
// from the record they read - which will not happen if it has been updated in the interim.
async fn merge<'a>(tx: &mut Transaction<'a, Sqlite>, item: &Item) -> Result<i64, AppError> {
    // We allow 3x retries when contending with competing thread
    let mut retries = 0;
    while retries < 3 {
        // Select for merge
        let result = sqlx::query_as!(
            SqlItem,
            r#"SELECT id as "id: Uuid", library_id as "library_id: Uuid",
          server_seq, tombstone_utc, attributes as "attributes: JsonAttributes"
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
            let server_seq = insert(tx, item).await?;
            return Ok(server_seq);
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
        // TODO: Put future timestamp protection here
        let mut src_attrs: ItemAttributes = sql_item
            .attributes
            .as_ref()
            .and_then(|json| serde_json::from_value::<ItemAttributesJson>(json.clone()).ok())
            .map(ItemAttributes::from)
            .unwrap();
        debug!("existing_attrs {:?}", src_attrs);
        src_attrs.merge(&item.attributes);

        let updated_attributes_json = convert_item_attributes_to_json(&src_attrs)?;
        let server_seq = now_micros();

        let last_server_seq = sql_item.server_seq as i64;

        let result = sqlx::query!(
            r#"UPDATE item
               SET attributes = ?, server_seq = ?
               WHERE id = ? AND library_id = ? AND tombstone_utc IS NULL AND server_seq = ?"#,
            updated_attributes_json,
            server_seq,
            item.id,
            item.library_id,
            last_server_seq,
        )
        .execute(tx.as_mut())
        .await?;

        if result.rows_affected() == 1 {
            return Ok(server_seq);
        } else {
            retries = retries + 1;
        }
    }
    return Err(AppError::ServerError(String::from(
        "Concurrent update failure",
    )));
}

#[async_trait]
impl ItemModel for ItemModelSqlite {
    // TODO: Break up this function so we are batching these, else each item necessitates at least 2 individual transactions
    async fn merge_many(&self, item: &Vec<Item>) -> Result<Vec<Option<i64>>, AppError> {
        let mut results: Vec<Option<i64>> = vec![];
        let mut tx = self.pool.begin().await?;
        for item in item {
            let server_seq = match merge(&mut tx, item).await {
                Ok(ts) => ts,
                Err(err) => {
                    // TODO: Propagate merge error to client?!
                    println!("{:?}", err);
                    results.push(None);
                    continue;
                }
            };
            results.push(Some(server_seq));
        }
        tx.commit().await?;
        Ok(results)
    }
    // TODO: Performance testing, w sqlite consider repeated smaller calls for use in stream
    fn get_by_library_stream<'a>(
        &'a self,
        library_id: &Uuid,
        server_seq: i64,
    ) -> Pin<
        Box<dyn futures_util::Stream<Item = Result<SqlItem, sqlx::Error>> + std::marker::Send + 'a>,
    > {
        sqlx::query_as::<_, SqlItem>(
            r#"SELECT id, library_id, server_seq, tombstone_utc, attributes
            FROM item
            WHERE library_id = ? AND server_seq >= ?
            ORDER BY server_seq ASC"#,
        )
        .bind(library_id.clone())
        .bind(server_seq)
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
        let qty = 100;
        let mut items = vec![];
        for _ in 0..qty {
            items.push(mock_item(primary_library_id))
        }
        db.item.merge_many(&items).await.unwrap();
        // intentional (smoke test): a second merge that effectively does nothing
        db.item.merge_many(&items).await.unwrap();
        let mut stream = db.item.get_by_library_stream(&primary_library_id, 0i64);
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
