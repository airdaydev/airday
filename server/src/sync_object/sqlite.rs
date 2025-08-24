use crate::{
    common::error::AppError,
    sync_object::{
        model::{
            ContainerAttrs, ItemAttrs, SqlSyncObject, SyncObject, SyncObjectAttrs, SyncObjectMeta,
            SyncObjectModel, sql_sync_to_sync_object,
        },
        types::sync_object_type,
    },
};
use async_trait::async_trait;
use crdt::timestamp::now_micros;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::pin::Pin;
use tracing::debug;
use uuid::Uuid;

pub struct SyncObjectModelSqlite {
    pool: SqlitePool,
}

impl SyncObjectModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

async fn insert<'a>(tx: &mut Transaction<'a, Sqlite>, item: &SyncObject) -> Result<i64, AppError> {
    let attributes_blob = item.attrs.get_attributes_blob()?;
    let server_seq = now_micros();
    let obj_type = match &item.attrs {
        SyncObjectAttrs::Item(_) => sync_object_type::ITEM,
        SyncObjectAttrs::Container(_) => sync_object_type::CONTAINER,
    };
    sqlx::query!(
        r#"INSERT INTO sync_object (id, library_id, obj_type, attributes, server_seq, tombstone_utc)
           VALUES (?, ?, ?, ?, ?, ?)"#,
        item.meta.id,
        item.meta.library_id,
        obj_type,
        attributes_blob,
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
          server_seq, tombstone_utc, attributes
          FROM sync_object
          WHERE library_id = ? AND id = ?"#,
            incoming_sync_obj.meta.library_id,
            incoming_sync_obj.meta.id,
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
            // TODO: Hints that user has not received, or is receiving this update - send the tombstone back somehow
            return Err(AppError::ValidationError(String::from(
                "sync_obj is tombstoned",
            )));
        }
        let mut sync_object: SyncObject = sql_sync_to_sync_object(&sql_sync_obj)?;
        sync_object.attrs.merge(&incoming_sync_obj.attrs);

        debug!("existing_attrs {:?}", sync_object);
        let Ok(attributes_blob) = sync_object.attrs.get_attributes_blob() else {
            return Err(AppError::ServerError(String::from(
                "Failed to translate merge output to blob",
            )));
        };
        let server_seq = now_micros();

        let last_server_seq = sql_sync_obj.server_seq as i64;

        let result = sqlx::query!(
            r#"UPDATE sync_object
               SET attributes = ?, server_seq = ?
               WHERE id = ? AND library_id = ? AND tombstone_utc IS NULL AND server_seq = ?"#,
            attributes_blob,
            server_seq,
            incoming_sync_obj.meta.id,
            incoming_sync_obj.meta.library_id,
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
    async fn get_by_id(
        &self,
        library_id: &Uuid,
        id: &Uuid,
    ) -> Result<Option<SqlSyncObject>, AppError> {
        let result = sqlx::query_as!(
            SqlSyncObject,
            r#"SELECT id as "id: Uuid", library_id as "library_id: Uuid",
            obj_type, server_seq, attributes, tombstone_utc
            FROM sync_object WHERE library_id = ? AND id = ? LIMIT 1"#,
            library_id,
            id,
        )
        .fetch_optional(&self.pool)
        .await?;
        let sql_sync_object = match result {
            Some(v) => v,
            None => return Ok(None),
        };
        let meta = SyncObjectMeta {
            id: sql_sync_object.id,
            library_id: sql_sync_object.library_id,
            server_seq: Some(sql_sync_object.server_seq),
            tombstone_utc: sql_sync_object.tombstone_utc,
        };
        let sync_object = match sql_sync_object.obj_type {
            sync_object_type::ITEM => {
                // TODO: Create attributes from proto
            }
            sync_object_type::CONTAINER => {
                // TODO: Create attributes from proto
            }
            _ => return Err(AppError::DatabaseError(String::from("Bad type"))),
        };
        // TODO: Determine type
        Ok(sync_object)
    }
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
            r#"SELECT id, library_id, obj_type, server_seq, tombstone_utc, attributes
            FROM sync_object
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
    use crate::{
        sync_object::model::ItemAttributes,
        test_util::{self, mock_item},
    };
    use crdt::LWWRegister;
    use futures_util::StreamExt;

    #[tokio::test]
    async fn sqlite_sync_object_merge() {
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("sync_object_merge@air.day")).await;
        let primary_library_id = user.primary_library.unwrap().id;
        let item = mock_item(
            primary_library_id,
            Some(ItemAttributes {
                text: Some(LWWRegister::<String>::new(String::from("old_text"), None).unwrap()),
            }),
        );
        db.sync_object.merge_many(&vec![item]).await.unwrap();
        // TODO: Get one
        // TODO: update item & merge again
        // TODO: Get one and confirm text is correct
    }

    #[tokio::test]
    async fn sqlite_library_stream() {
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("lib_stream_merge@air.day")).await;
        let primary_library_id = user.primary_library.unwrap().id;
        let qty = 100;
        let mut items = vec![];
        for _ in 0..qty {
            items.push(mock_item(primary_library_id, None))
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
