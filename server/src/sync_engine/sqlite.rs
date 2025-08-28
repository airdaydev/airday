use crate::{
    common::error::AppError,
    sync_engine::{
        any::AnySyncObject,
        engine::{SqlSyncObject, SyncObjectModel},
    },
};
use async_trait::async_trait;
use crdt::timestamp::now_micros;
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::pin::Pin;
use uuid::Uuid;

pub struct SyncObjectModelSqlite {
    pool: SqlitePool,
}

impl SyncObjectModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

async fn insert<'a>(
    tx: &mut Transaction<'a, Sqlite>,
    sync_obj: &AnySyncObject,
) -> Result<i64, AppError> {
    let attributes_blob = sync_obj.to_attr_blob()?;
    let server_seq = now_micros();
    let obj_type = sync_obj.obj_type();
    sqlx::query!(
        r#"INSERT INTO sync_object (id, library_id, obj_type, attributes, server_seq, tombstone_utc)
           VALUES (?, ?, ?, ?, ?, ?)"#,
        sync_obj.meta().id,
        sync_obj.meta().library_id,
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
    incoming_sync_obj: &AnySyncObject,
) -> Result<i64, AppError> {
    // Select for merge
    let result = sqlx::query_as!(
        SqlSyncObject,
        r#"SELECT id as "id: Uuid", library_id as "library_id: Uuid", obj_type,
          server_seq, tombstone_utc, attributes
          FROM sync_object
          WHERE library_id = ? AND id = ?"#,
        incoming_sync_obj.meta().library_id,
        incoming_sync_obj.meta().id,
    )
    .fetch_optional(tx.as_mut())
    .await?;
    // 2. Check if sync_obj exists
    let Some(sql_sync_obj) = result else {
        // Obj does not exist, insert new sync_obj
        let server_seq = insert(tx, incoming_sync_obj).await?;
        return Ok(server_seq);
    };
    if let Some(_) = sql_sync_obj.tombstone_utc {
        // obj is tombstones - discard changes
        // TODO: Hints that user has not received, or is receiving this update - send the tombstone back somehow
        return Err(AppError::ValidationError(String::from(
            "sync_obj is tombstoned",
        )));
    }
    if sql_sync_obj.obj_type != incoming_sync_obj.obj_type() {
        return Err(AppError::DatabaseError(String::from(
            "Incorrect merge type",
        )));
    }
    let last_server_seq = sql_sync_obj.server_seq as i64;
    let mut existing_object: AnySyncObject = sql_sync_obj.try_into()?;
    existing_object.merge_into(&incoming_sync_obj);

    let Ok(attr_blob) = existing_object.to_attr_blob() else {
        return Err(AppError::ServerError(String::from(
            "Failed to translate merge output to blob",
        )));
    };
    let server_seq = now_micros();

    let result = sqlx::query!(
        r#"UPDATE sync_object
               SET attributes = ?, server_seq = ?
               WHERE id = ? AND library_id = ? AND tombstone_utc IS NULL AND server_seq = ?"#,
        attr_blob,
        server_seq,
        incoming_sync_obj.meta().id,
        incoming_sync_obj.meta().library_id,
        last_server_seq,
    )
    .execute(tx.as_mut())
    .await?;

    if result.rows_affected() == 1 {
        return Ok(server_seq);
    } else {
        return Err(AppError::RetryReq());
    }
}

#[async_trait]
impl SyncObjectModel for SyncObjectModelSqlite {
    async fn get_by_id(
        &self,
        library_id: &Uuid,
        id: &Uuid,
    ) -> Result<Option<AnySyncObject>, AppError> {
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
        let sync_object: AnySyncObject = sql_sync_object.try_into()?;
        Ok(Some(sync_object))
    }
    // TODO: Break up this function so we are batching these, else each sync_object necessitates at least 2 individual transactions
    async fn merge_many(
        &self,
        sync_objects: &Vec<AnySyncObject>,
    ) -> Result<Vec<Option<i64>>, AppError> {
        let mut results: Vec<Option<i64>> = vec![];
        let mut retries = vec![];
        let mut tx = self.pool.begin().await?;
        let idx = 0;
        for sync_object in sync_objects {
            let server_seq = match merge(&mut tx, sync_object).await {
                Ok(seq) => seq,
                Err(err) => {
                    println!("{:?}", err);
                    if let AppError::RetryReq() = err {
                        // Likely a contended result
                        retries.push((idx, sync_object));
                    } else {
                        results.push(None);
                    }
                    // TODO: Propagate merge error to client?!
                    continue;
                }
            };
            results.push(Some(server_seq));
        }
        tx.commit().await?;
        // Slow batch retry (most likely, due to contention)
        // TODO: Try multiple times?
        for sync_object in retries {
            let mut tx = self.pool.begin().await?;
            match merge(&mut tx, sync_object.1).await {
                Ok(seq) => {
                    results[sync_object.0] = Some(seq);
                }
                Err(err) => {
                    println!("Merge retry failure: {:?}", err);
                    // TODO: Leave Failure
                }
            }
            if let Err(msg) = tx.commit().await {
                println!("Merge retry failure {}", msg);
            }
        }
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
    use std::panic;

    use crate::{
        sync_engine::{any::AnySyncObject, item::ItemAttrs},
        test_util::{self, mock_item, mock_item_any},
    };
    use crdt::LWWRegister;
    use futures_util::StreamExt;

    #[tokio::test]
    async fn sqlite_sync_object_merge() {
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("sync_object_merge@air.day")).await;
        let primary_library_id = user.primary_library.unwrap().id;
        let mut item = mock_item(
            primary_library_id,
            None,
            Some(ItemAttrs {
                text: Some(LWWRegister::<String>::new(String::from("old_text"), None)),
            }),
        );
        let wrapped_item = AnySyncObject::Item(item.clone());
        db.sync_object
            .merge_many(&vec![wrapped_item])
            .await
            .unwrap();
        let Ok(Some(res)) = db
            .sync_object
            .get_by_id(&item.meta.library_id.clone(), &item.meta.id.clone())
            .await
        else {
            panic!("Failed to retrieve item after initial merge");
        };
        match res {
            AnySyncObject::Item(val) => {
                assert_eq!(val.attrs.text.unwrap().data, String::from("old_text"));
            }
            _ => {
                assert!(false);
                return;
            }
        };
        // Update and run again
        let updated_item = mock_item(
            item.meta.library_id,
            Some(item.meta.id),
            Some(ItemAttrs {
                text: Some(LWWRegister::<String>::new(String::from("new_text"), None)),
            }),
        );
        item.merge_attrs(&updated_item.attrs);
        let wrapped_updated = AnySyncObject::Item(item.clone());
        db.sync_object
            .merge_many(&vec![wrapped_updated.clone()])
            .await
            .unwrap();
        let Ok(Some(res_2)) = db
            .sync_object
            .get_by_id(&item.meta.library_id, &item.meta.id)
            .await
        else {
            panic!("Failed to retrieve item after initial merge");
        };
        match res_2 {
            AnySyncObject::Item(val) => {
                assert_eq!(val.attrs.text.unwrap().data, String::from("new_text"));
            }
            _ => {
                assert!(false);
            }
        }
    }

    // TODO: concurrent_merge tests

    #[tokio::test]
    async fn sqlite_library_stream() {
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("lib_stream_merge@air.day")).await;
        let primary_library_id = user.primary_library.unwrap().id;
        let qty = 100;
        let mut items = vec![];
        for _ in 0..qty {
            items.push(mock_item_any(primary_library_id, None, None));
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
