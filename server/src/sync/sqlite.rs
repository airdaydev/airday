use crate::{
    common::error::AppError,
    sync::{
        engine::{IncomingSyncOp, Seq, SyncOpModel, SyncOpSql},
        proto_generated::proto::OpKind,
    },
};
use async_trait::async_trait;
use crdt::timestamp::now_micros;
use sqlx::{Pool, Sqlite, SqlitePool, Transaction};
use std::pin::Pin;
use uuid::Uuid;

pub struct SyncOpModelSqlite {
    pool: SqlitePool,
}

impl SyncOpModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

async fn insert<'a>(
    // tx: &mut Transaction<'a, Sqlite>,
    pool: &Pool<Sqlite>,
    op: &IncomingSyncOp,
) -> Result<i64, AppError> {
    let now = now_micros();
    let payload = op.payload.as_ref();
    let payload_sha256 = vec![0u8; 32]; // TODO: Calculate actual SHA256 of payload
    let result = sqlx::query!(
        r#"INSERT INTO sync_op (
            base_seq, archived, op_id, op_kind,
            library_id, obj_id, path, obj_kind,
            payload, payload_sha256,
            tombstone_utc, created_utc, client_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        op.base_seq,
        false, // archived = false for new operations
        op.op_id,
        op.op_kind,
        op.library_id,
        op.obj_id,
        op.path,
        op.obj_kind,
        payload,
        payload_sha256,
        op.tombstone_utc,
        now,
        None::<Uuid> // TODO: Get client_id from somewhere
    )
    .execute(pool)
    // .execute(tx.as_mut())
    .await?;
    Ok(result.last_insert_rowid())
}

// TODO: We are no longer CASing but will leave this temporarily for reference
// async fn merge<'a>(
//     tx: &mut Transaction<'a, Sqlite>,
//     incoming_sync_obj: &SyncOp,
// ) -> Result<i64, AppError> {
//     // Select for merge
//     let result = sqlx::query_as!(
//         SqlSyncOp,
//         r#"SELECT id as "id: Uuid", library_id as "library_id: Uuid", obj_kind,
//           server_seq, tombstone_utc, attributes
//           FROM sync_op
//           WHERE library_id = ? AND id = ?"#,
//         incoming_sync_obj.meta().library_id,
//         incoming_sync_obj.meta().id,
//     )
//     .fetch_optional(tx.as_mut())
//     .await?;
//     // 2. Check if sync_obj exists
//     let Some(sql_sync_obj) = result else {
//         // Obj does not exist, insert new sync_obj
//         let server_seq = insert(tx, incoming_sync_obj).await?;
//         return Ok(server_seq);
//     };
//     if let Some(_) = sql_sync_obj.tombstone_utc {
//         // obj is tombstones - discard changes
//         // TODO: Hints that user has not received, or is receiving this update - send the tombstone back somehow
//         return Err(AppError::ValidationError(String::from(
//             "sync_obj is tombstoned",
//         )));
//     }
//     if sql_sync_obj.obj_kind as i16 != incoming_sync_obj.obj_kind() {
//         return Err(AppError::DatabaseError(String::from(
//             "Incorrect merge type",
//         )));
//     }
//     let last_server_seq = sql_sync_obj.server_seq as i64;
//     let mut existing_object: SyncOp = sql_sync_obj.try_into()?;
//     existing_object.merge_into(&incoming_sync_obj);

//     let Ok(attr_blob) = existing_object.to_attr_blob() else {
//         return Err(AppError::ServerError(String::from(
//             "Failed to translate merge output to blob",
//         )));
//     };
//     let server_seq = now_micros();

//     let result = sqlx::query!(
//         r#"UPDATE sync_op
//                SET attributes = ?, server_seq = ?
//                WHERE id = ? AND library_id = ? AND tombstone_utc IS NULL AND server_seq = ?"#,
//         attr_blob,
//         server_seq,
//         incoming_sync_obj.meta().id,
//         incoming_sync_obj.meta().library_id,
//         last_server_seq,
//     )
//     .execute(tx.as_mut())
//     .await?;

//     if result.rows_affected() == 1 {
//         return Ok(server_seq);
//     } else {
//         return Err(AppError::RetryReq());
//     }
// }

#[async_trait]
impl SyncOpModel for SyncOpModelSqlite {
    async fn get_by_seq(&self, seq: i64) -> Result<Option<SyncOpSql>, AppError> {
        let result = sqlx::query_as!(
            SyncOpSql,
            r#"SELECT seq, base_seq, archived, op_kind,
            library_id as "library_id: Uuid",
            obj_id as "obj_id: Uuid", path, obj_kind,
            payload, payload_sha256,
            tombstone_utc, created_utc, client_id as "client_id: Uuid"
            FROM sync_op WHERE seq = ? LIMIT 1"#,
            seq,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(result)
    }
    // Baseline approach, measure and upgrade to multi-insert
    async fn apply(&self, op: &IncomingSyncOp) -> Result<Seq, AppError> {
        // let mut tx = self.pool.begin().await?;

        if op.op_kind == OpKind::PATCH.0 {
            // Insert a new patch operation
            let seq = insert(&self.pool, op).await?;

            // Return the seq (rowid) of the inserted operation
            Ok(seq)
        } else {
            // Delete = archive all (library_id, obj_id), add tombstone op (NO PAYLOAD?)
            // Snapshot = archive all (library_id, obj_id), add snapshot op
            panic!("Currently only OpKind::Patch supported");
        }
    }

    // TODO: Performance testing, w sqlite consider repeated smaller calls for use in stream
    fn get_by_library_stream<'a>(
        &'a self,
        library_id: &Uuid,
        from_seq: i64,
    ) -> Pin<
        Box<
            dyn futures_util::Stream<Item = Result<SyncOpSql, sqlx::Error>>
                + std::marker::Send
                + 'a,
        >,
    > {
        sqlx::query_as::<_, SyncOpSql>(
            r#"SELECT seq, base_seq, op_kind, library_id, obj_id, path, obj_kind,
            payload, payload_sha256, tombstone_utc, created_utc, client_id
            FROM sync_op
            WHERE library_id = ? AND seq >= ?
            ORDER BY seq ASC"#,
        )
        .bind(library_id.clone())
        .bind(from_seq)
        .fetch(&self.pool)
    }
}

#[cfg(test)]
mod tests {
    use std::panic;

    use crate::test_util::{self, mock_incoming_op};
    // use crdt::LWWRegister;
    use futures_util::StreamExt;

    #[tokio::test]
    async fn sqlite_sync_op_apply() {
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("sync_op_merge@air.day")).await;
        let primary_library_id = user.primary_library.unwrap().id;
        let op = mock_incoming_op(primary_library_id, None);
        let seq = db.sync_op.apply(&op).await.unwrap();
        println!("The sync number is {}", seq);
        assert!(seq >= 0);
        let Ok(Some(sql_op)) = db.sync_op.get_by_seq(seq).await else {
            panic!("Failed to retrieve op after apply");
        };
        assert_eq!(sql_op.seq, seq);
        assert_eq!(sql_op.archived, false);
        assert_eq!(sql_op.payload.len(), 0); // TODO: Client id!
    }

    // TODO: concurrent_merge tests
    // #[tokio::test]
    // async fn sqlite_library_stream() {
    //     let db = test_util::create_test_db().await;
    //     let user = test_util::mock_user(&db, String::from("lib_stream_merge@air.day")).await;
    //     let primary_library_id = user.primary_library.unwrap().id;
    //     let qty = 100;
    //     let mut items = vec![];
    //     for _ in 0..qty {
    //         items.push(mock_item_any(primary_library_id, None, None));
    //     }
    //     db.sync_op.merge_many(&items).await.unwrap();
    //     // intentional (smoke test): a second merge that effectively does nothing
    //     db.sync_op.merge_many(&items).await.unwrap();
    //     let mut stream = db.sync_op.get_by_library_stream(&primary_library_id, 0i64);
    //     let mut count = 0;
    //     while let Some(result) = stream.next().await {
    //         match result {
    //             Ok(_item) => count += 1,
    //             Err(e) => panic!("Stream error: {}", e),
    //         }
    //     }

    //     assert_eq!(count, qty);
    // }
}
