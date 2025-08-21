use async_trait::async_trait;
use crdt::timestamp::now_micros;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::{any::Any, pin::Pin};
use tracing::debug;
use uuid::Uuid;

use crate::{
    common::error::AppError,
    sync_object::{
        model::{
            ItemAttributes, ItemAttributesJson, JsonAttributes, ListAttributes, ListAttributesJson,
            SqlSyncObject, SyncObject, SyncObjectMeta, SyncObjectModel,
        },
        types::sync_object_type,
    },
};

pub struct SyncObjectModelSqlite {
    pool: SqlitePool,
}

impl SyncObjectModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

async fn insert<'a>(tx: &mut Transaction<'a, Sqlite>, item: &SyncObject) -> Result<i64, AppError> {
    let attributes_json = item.get_attributes_json()?;
    let server_seq = now_micros();
    sqlx::query!(
        r#"INSERT INTO sync_object (id, library_id, attributes, server_seq, tombstone_utc)
           VALUES (?, ?, ?, ?, ?)"#,
        item.get_meta().id,
        item.get_meta().library_id,
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
// TODO: We could consider cutting out the full object and just concentrating on the attributes
async fn merge<'a>(
    tx: &mut Transaction<'a, Sqlite>,
    incoming_sync_obj: &SyncObject,
) -> Result<i64, AppError> {
    // We allow 3x retries when contending with competing thread
    let mut retries = 0;
    while retries < 3 {
        // Select for merge
        let result = sqlx::query_as!(
            SqlSyncObject,
            r#"SELECT id as "id: Uuid", library_id as "library_id: Uuid", obj_type,
          server_seq, tombstone_utc, attributes as "attributes: JsonAttributes"
          FROM sync_object
          WHERE library_id = ? AND id = ?"#,
            incoming_sync_obj.get_meta().library_id,
            incoming_sync_obj.get_meta().id,
        )
        .fetch_optional(tx.as_mut())
        .await?;
        // 2. Check if sync_obj exists
        let Some(sql_sync_obj) = result else {
            // Item does not exist, insert new sync_obj
            let server_seq = insert(tx, incoming_sync_obj).await?;
            return Ok(server_seq);
        };
        if let Some(_) = sql_sync_obj.tombstone_utc {
            // Item is tombstones - discard changes
            // TODO: The user SHOULD not encounter this, and if they do, be informed of it.
            return Err(AppError::ValidationError(String::from(
                "sync_obj is tombstoned",
            )));
        }
        let meta = SyncObjectMeta {
            id: sql_sync_obj.id,
            library_id: sql_sync_obj.library_id,
            server_seq: Some(sql_sync_obj.server_seq),
            tombstone_utc: sql_sync_obj.tombstone_utc,
        };
        let sync_object: SyncObject = match sql_sync_obj.obj_type {
            sync_object_type::ITEM_TYPE => {
                if !matches!(incoming_sync_obj, SyncObject::Item { .. }) {
                    return Err(AppError::DatabaseError(String::from(
                        "Type mismatch on merge",
                    )));
                }
                let mut attrs: ItemAttributes = sql_sync_obj
                    .attributes
                    .as_ref()
                    .and_then(|json| {
                        serde_json::from_value::<ItemAttributesJson>(json.clone()).ok()
                    })
                    .map(ItemAttributes::from)
                    .unwrap();
                SyncObject::Item { meta, attrs }
            }
            sync_object_type::CONTAINER_TYPE => {
                if !matches!(incoming_sync_obj, SyncObject::Item { .. }) {
                    return Err(AppError::DatabaseError(String::from(
                        "Type mismatch on merge",
                    )));
                }
                let mut attrs: ListAttributes = sql_sync_obj
                    .attributes
                    .as_ref()
                    .and_then(|json| {
                        serde_json::from_value::<ListAttributesJson>(json.clone()).ok()
                    })
                    .map(ListAttributes::from)
                    .unwrap();
                SyncObject::Container { meta, attrs }
            }
            other_type => {
                // Unknown type, throw
                return Err(AppError::DatabaseError(format!("Bad type: {}", other_type)));
            }
        };

        // TODO: Put future timestamp protection here
        debug!("existing_attrs {:?}", sync_object);
        sync_object.merge(&incoming_sync_obj); // TODO: Merge per sync_obj!

        // let updated_attributes_json = convert_sync_obj_attributes_to_json(&src_attrs)?;
        // TODO: Convert back to JSON to store!
        let server_seq = now_micros();

        let last_server_seq = sql_sync_obj.server_seq as i64;

        let result = sqlx::query!(
            r#"UPDATE sync_object
               SET attributes = ?, server_seq = ?
               WHERE id = ? AND library_id = ? AND tombstone_utc IS NULL AND server_seq = ?"#,
            updated_attributes_json,
            server_seq,
            incoming_sync_obj.get_meta().id,
            incoming_sync_obj.get_meta().library_id,
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
impl SyncObjectModel for SyncObjectModelSqlite {
    // TODO: Break up this function so we are batching these, else each item necessitates at least 2 individual transactions
    async fn merge_many(&self, item: &Vec<SyncObject>) -> Result<Vec<Option<i64>>, AppError> {
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
        Box<
            dyn futures_util::Stream<Item = Result<SqlSyncObject, sqlx::Error>>
                + std::marker::Send
                + 'a,
        >,
    > {
        sqlx::query_as::<_, SqlSyncObject>(
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
        db.sync_object.merge_many(&items).await.unwrap();
        // intentional (smoke test): a second merge that effectively does nothing
        db.sync_object.merge_many(&items).await.unwrap();
        let mut stream = db
            .sync_object
            .get_by_library_stream(&primary_library_id, 0i64);
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
