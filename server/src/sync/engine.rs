use crate::{
    auth::cache::AuthCache,
    common::{error::AppError, sql::Db},
    sync::{
        batch_response::BatchResponse,
        fb::{build_batch_sync_msg, wrap_message},
        proto_generated::proto::{AttributeProto, MessageProto, OpKind},
        websocket::{WebsocketState, send_to_client},
    },
};
use async_trait::async_trait;
use axum::body::Bytes;
use flatbuffers::FlatBufferBuilder;
use sqlx::prelude::FromRow;
use std::pin::Pin;
use tokio::sync::mpsc::{self, Sender};
use uuid::Uuid;

pub type PayloadBlob = Vec<u8>;
pub type Sha256 = Vec<u8>;
pub type Seq = i64;

pub type AttributeFBVec<'a> =
    Option<flatbuffers::Vector<'a, flatbuffers::ForwardsUOffset<AttributeProto<'a>>>>;

pub struct IncomingSyncOp {
    // sync concerns
    pub base_seq: Option<Seq>, // only for snapshots
    pub op_id: Uuid,
    pub op_kind: i8, // TODO: CONST these types
    // static attrs
    pub library_id: Uuid, //
    pub obj_id: Uuid,
    pub obj_kind: i16,
    pub path: i16,
    pub tombstone_utc: Option<i16>,
    // payload
    pub payload: Bytes,
}

pub struct IncomingSyncOpBatch {
    pub socket_id: Uuid,
    pub user_id: Uuid,
    pub ops: Vec<IncomingSyncOp>,
}

#[derive(FromRow)]
pub struct SyncOp {
    // sync concerns
    pub seq: Option<Seq>,
    pub base_seq: i64,   // snapshot seq base
    pub op_kind: OpKind, // TODO: Specify allowable enums
    pub archived: bool,
    // static attrs
    pub library_id: Uuid,
    pub obj_id: Uuid,
    pub obj_kind: i16,
    pub path: i16, // used for complex subfields e.g. text crdts (0 = no path)
    // flatbuffer blob (may be encrypted)
    pub payload: Option<PayloadBlob>, // Tied to flatbuffer
    pub payload_sha256: Option<Sha256>,
    // metadata
    pub tombstone_utc: Option<i64>,
    pub created_utc: Option<i64>,
    pub client_id: Option<Uuid>,
}

#[derive(FromRow)]
pub struct SyncOpSql {
    // sync concerns
    pub seq: Seq,
    pub base_seq: Option<i64>, // snapshot seq base
    pub op_kind: i64,          // TODO: Specify allowable enums
    pub archived: bool,
    // static attrs
    pub library_id: Uuid,
    pub obj_id: Uuid,
    pub path: Option<i64>, // used for complex subfields e.g. text crdts
    pub obj_kind: i64,
    // flatbuffer blob (may be encrypted)
    pub payload: PayloadBlob,
    pub payload_sha256: Sha256,
    // metadata
    pub tombstone_utc: Option<i64>,
    pub created_utc: i64,
    pub client_id: Option<Uuid>,
}

#[derive(Clone)]
pub struct OpBatchProcessor {
    pub tx: Sender<IncomingSyncOpBatch>,
}

impl OpBatchProcessor {
    pub async fn start(ws: &WebsocketState, auth_cache: &AuthCache, db: &Db) -> Self {
        let (tx, rx) = mpsc::channel::<IncomingSyncOpBatch>(100);
        // rx to hook up to batch_processor
        tokio::spawn(process_batch_ops(
            rx,
            ws.clone(),
            auth_cache.clone(),
            db.clone(),
        ));
        Self { tx }
    }
}

// Optimisation: Transactions
async fn process_batch_ops(
    mut rx: mpsc::Receiver<IncomingSyncOpBatch>,
    ws: WebsocketState,
    auth_cache: AuthCache,
    db: Db,
) {
    while let Some(batch) = rx.recv().await {
        let mut responses: Vec<BatchResponse> = Vec::new();
        // TODO: Optimisation: Local cache for batch.user_id?
        for op in batch.ops {
            if auth_cache.check(&db, &batch.user_id, &op.library_id).await == false {
                responses.push(BatchResponse::Error {
                    op_id: Some(op.op_id),
                    message: String::from("unauthorised"),
                });
                continue;
            }
            // TODO: 1x transaction for all?!
            match db.sync_op.apply(&op).await {
                Ok(seq) => responses.push(BatchResponse::Applied {
                    op_id: op.op_id,
                    seq: seq,
                }),
                Err(err) => {
                    println!("{err:?}"); // TODO: Telemetry
                    responses.push(BatchResponse::Error {
                        op_id: Some(op.op_id), // TODO: distinguish op vs action id?!
                        message: String::from("apply_error"),
                    });
                    continue;
                }
            };
        }
        let mut builder = FlatBufferBuilder::new();
        let message_offset = build_batch_sync_msg(&mut builder, responses);
        let message = wrap_message(&mut builder, MessageProto::BatchSyncProto, message_offset);
        send_to_client(&ws, &batch.socket_id, message).await;
    }
}

#[async_trait]
pub trait SyncOpModel: Send + Sync {
    async fn get_by_seq(&self, seq: i64) -> Result<Option<SyncOpSql>, AppError>;
    // Accept query options
    fn get_by_library_stream<'a>(
        &'a self,
        library_id: &Uuid,
        seq: i64,
    ) -> Pin<
        Box<
            dyn futures_util::Stream<Item = Result<SyncOpSql, sqlx::Error>>
                + std::marker::Send
                + 'a,
        >,
    >;
    async fn apply(&self, op: &IncomingSyncOp) -> Result<Seq, AppError>;
    // async fn get_by_id(&self, id: &Uuid) -> Result<Option<Item>, AppError>;
}
