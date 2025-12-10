use crate::{
    common::error::AppError,
    sync::{
        batch_response::BatchResponse,
        engine::{IncomingSyncOp, OpLibMap, SyncOpModel, SyncOpSql},
        proto_generated::proto::OpKind,
    },
};
use async_trait::async_trait;
use crdt::timestamp::now_micros;
use sqlx::{Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

pub struct SyncOpModelSqlite {
    pool: SqlitePool,
}

impl SyncOpModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

// Sqlite has 999 binds available per statement
const SQLITE_MAX_PARAMS: usize = 999;
const FIELDS_PER_ROW: usize = 13; // confirm with fn insert()
pub const OPTIMAL_ROWS_PER_INSERT: usize = SQLITE_MAX_PARAMS / FIELDS_PER_ROW;

async fn insert<'a>(
    tx: &mut Transaction<'a, Sqlite>,
    op: &IncomingSyncOp,
    seq: i64,
) -> Result<i64, AppError> {
    // TODO: start seq block with tx
    // TODO: End seq block
    let now = now_micros();
    let payload = op.payload.as_ref();
    let payload_sha256 = vec![0u8; 32]; // TODO: Calculate actual SHA256 of payload
    let result = sqlx::query!(
        r#"INSERT INTO sync_op (
            seq, base_seq, op_id, op_kind,
            library_id, obj_id, path, obj_kind,
            payload, payload_sha256, created_utc, client_id, archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        seq,
        op.base_seq,
        op.op_id,
        op.op_kind,
        op.library_id,
        op.obj_id,
        op.path,
        op.obj_kind,
        payload,
        payload_sha256,
        now,
        None::<Uuid>, // TODO: Get client_id from somewhere
        false,        // archived = false for new operations
    )
    .execute(tx.as_mut())
    .await?;
    Ok(result.last_insert_rowid())
}

async fn insert_multi<'a>(
    tx: &mut Transaction<'a, Sqlite>,
    op_vec: &[IncomingSyncOp],
    start_seq: i64,
) -> Result<(), AppError> {
    if op_vec.is_empty() {
        return Ok(());
    }

    let now = now_micros();
    let payload_sha256 = vec![0u8; 32]; // TODO: Calculate actual SHA256 of payload

    // Process in chunks of OPTIMAL_ROWS_PER_INSERT to stay within SQLite's parameter limit
    for (chunk_idx, chunk) in op_vec.chunks(OPTIMAL_ROWS_PER_INSERT).enumerate() {
        // println!("CHUNK bruh {}", chunk_idx);
        let chunk_start_seq = start_seq + (chunk_idx * OPTIMAL_ROWS_PER_INSERT) as i64;

        // Build the SQL with multiple VALUE clauses
        let mut sql = String::from(
            "INSERT INTO sync_op (
                seq, base_seq, op_id, op_kind,
                library_id, obj_id, path, obj_kind,
                payload, payload_sha256, created_utc, client_id, archived
            ) VALUES ",
        );

        let placeholders = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        let values_clauses: Vec<_> = (0..chunk.len()).map(|_| placeholders).collect();
        sql.push_str(&values_clauses.join(", "));

        let mut query = sqlx::query(&sql);

        // Bind all parameters for this chunk
        for (i, op) in chunk.iter().enumerate() {
            let seq = chunk_start_seq + i as i64;
            let payload = op.payload.as_ref();

            query = query
                .bind(seq)
                .bind(op.base_seq)
                .bind(op.op_id)
                .bind(op.op_kind)
                .bind(op.library_id)
                .bind(op.obj_id)
                .bind(&op.path)
                .bind(op.obj_kind)
                .bind(payload)
                .bind(&payload_sha256)
                .bind(now)
                .bind(None::<Uuid>) // TODO: Get client_id from somewhere
                .bind(false); // archived = false for new operations
        }

        query.execute(tx.as_mut()).await?;
    }

    Ok(())
}

async fn allocate_block<'a>(
    tx: &mut Transaction<'a, Sqlite>,
    library_id: &Uuid,
    block_len: usize,
) -> Result<i64, AppError> {
    let seq: i64 = sqlx::query_scalar(
        "UPDATE library
        SET seq = seq + ?
        WHERE id = ?
        RETURNING seq",
    )
    .bind(block_len as i64)
    .bind(library_id)
    .fetch_one(tx.as_mut())
    .await?;
    Ok(seq - block_len as i64)
}

#[async_trait]
impl SyncOpModel for SyncOpModelSqlite {
    async fn get_by_seq(&self, library_id: &Uuid, seq: i64) -> Result<Option<SyncOpSql>, AppError> {
        let result = sqlx::query_as!(
            SyncOpSql,
            r#"SELECT op_id as "op_id: Uuid", library_id as "library_id: Uuid",
            seq, base_seq, archived, op_kind,
            obj_id as "obj_id: Uuid", path, obj_kind,
            payload, payload_sha256, created_utc, client_id as "client_id: Uuid"
            FROM sync_op WHERE library_id = ? AND seq = ? LIMIT 1"#,
            library_id,
            seq,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(result)
    }
    // // Baseline approach, measure and upgrade to multi-insert
    // async fn apply(&self, op: &IncomingSyncOp) -> Result<Seq, AppError> {
    //     // let mut tx = self.pool.begin().await?;

    //     if op.op_kind == OpKind::PATCH.0 {
    //         // Insert a new patch operation
    //         let seq = insert(&self.pool, op).await?;

    //         // Return the seq (rowid) of the inserted operation
    //         Ok(seq)
    //     } else {
    //         // Delete = archive all (library_id, obj_id), add tombstone op (NO PAYLOAD?)
    //         // Snapshot = archive all (library_id, obj_id), add snapshot op
    //         panic!("Currently only OpKind::Patch supported");
    //     }
    // }

    async fn apply_block(&self, op_lib_map: &OpLibMap) -> Result<Vec<BatchResponse>, AppError> {
        let mut responses = vec![];
        let mut tx = self.pool.begin().await?;

        let libs: Vec<Uuid> = op_lib_map.keys().cloned().collect();

        for library_id in libs {
            let Some(op_vec) = op_lib_map.get(&library_id) else {
                continue;
            };
            let block_len = op_vec.len();
            let start_seq = allocate_block(&mut tx, &library_id, block_len).await?;

            // Validate all ops are supported types before inserting
            for op in op_vec.iter() {
                if op.op_kind != OpKind::PATCH.0 && op.op_kind != OpKind::SNAPSHOT.0 {
                    panic!("Currently only OpKind::Patch/Snapshot supported");
                }
            }

            // Batch insert all operations for this library
            insert_multi(&mut tx, op_vec, start_seq).await?;

            // Build responses for each inserted operation
            for (i, op) in op_vec.iter().enumerate() {
                responses.push(BatchResponse::Applied {
                    op_id: op.op_id,
                    seq: start_seq + i as i64,
                });
            }
        }
        tx.commit().await?;
        Ok(responses)
    }

    async fn get_stream_head(&self, library_id: &Uuid) -> Result<i64, AppError> {
        let head: i64 =
            sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) FROM sync_op WHERE library_id = ?")
                .bind(library_id)
                .fetch_one(&self.pool)
                .await?;
        Ok(head)
    }

    // TODO: Performance testing, w sqlite consider repeated smaller calls for use in stream
    async fn seq_range(
        &self,
        library_id: &Uuid,
        from_seq: i64,
        max_seq: i64,
        chunk_size: i64,
    ) -> Result<Vec<SyncOpSql>, sqlx::Error> {
        // println!(
        //     "from: {}, to: {}, chunk_size: {}",
        //     from_seq, max_seq, chunk_size
        // );
        sqlx::query_as::<_, SyncOpSql>(
            r#"SELECT op_id, seq, base_seq,
            op_kind, library_id,
            obj_id, path, obj_kind, archived,
            payload, payload_sha256, created_utc, client_id
            FROM sync_op
            WHERE library_id = ? AND seq >= ? AND seq <= ?
            ORDER BY seq ASC LIMIT ?"#,
        )
        .bind(library_id.clone())
        .bind(from_seq)
        .bind(max_seq)
        .bind(chunk_size)
        .fetch_all(&self.pool)
        .await
    }
}

#[cfg(test)]
mod tests {
    use std::panic;

    use crate::{
        sync::{batch_response::BatchResponse, engine::create_op_lib_map},
        test_util::{self, mock_incoming_op},
    };
    // use crdt::LWWRegister;

    #[tokio::test]
    async fn sqlite_sync_op_apply() {
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("sync_op_merge@air.day")).await;
        let library_id = user.primary_library.id;
        let op = mock_incoming_op(library_id, None);
        let map = create_op_lib_map(vec![op]);
        let res = db.sync_op.apply_block(&map).await.unwrap();
        let BatchResponse::Applied { op_id: _, seq } = res[0] else {
            panic!("First res did not pass");
        };
        assert!(seq >= 0);
        let Ok(Some(sql_op)) = db.sync_op.get_by_seq(&library_id, seq).await else {
            panic!("Failed to retrieve op after apply");
        };
        assert_eq!(sql_op.seq, seq);
        assert_eq!(sql_op.archived, false);
        assert_eq!(sql_op.payload.len(), 0); // TODO: Client id!
    }

    // TODO: Performance baseline of pushing objects

    #[tokio::test]
    async fn sqlite_stream_from_seq() {
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("lib_stream_merge@air.day")).await;
        let library_id = user.primary_library.id;
        let qty = 100;
        let mut ops = vec![];
        for _ in 0..qty {
            ops.push(mock_incoming_op(library_id, None));
        }
        let map = create_op_lib_map(ops);
        db.sync_op.apply_block(&map).await.unwrap();
        let head = db.sync_op.get_stream_head(&library_id).await.unwrap();
        let chunk_size = 5;
        let next = match db.sync_op.seq_range(&library_id, 0, head, chunk_size).await {
            Ok(next) => next,
            Err(err) => {
                panic!("Error calling seq_range - {:?}", err);
            }
        };
        assert_eq!(next.len() as i64, chunk_size, "chunk length matches");
        let last_seq = next[next.len() - 1].seq;
        assert_eq!(
            last_seq,
            chunk_size - 1,
            "last seq matches chunk size after 0 seq for lib"
        );
        let next_2 = db
            .sync_op
            .seq_range(&library_id, last_seq + 1, head, chunk_size)
            .await
            .unwrap();
        let first_seq = next_2[0].seq;
        assert!(first_seq > last_seq, "continue from next seq");
        assert!(head > last_seq);
    }
}
