use crate::{
    auth::cache::AuthCache,
    common::{error::AppError, sql::Db},
    sync::{proto_generated::proto::AttributeProto, sync::BatchAction, websocket::WebsocketState},
};
use async_trait::async_trait;
use axum::body::Bytes;
use sqlx::prelude::FromRow;
use std::pin::Pin;
use tokio::sync::mpsc::{self, Sender};
use uuid::Uuid;

pub type PayloadBlob = Vec<u8>;
pub type Sha256 = Vec<u8>;

pub type AttributeFBVec<'a> =
    Option<flatbuffers::Vector<'a, flatbuffers::ForwardsUOffset<AttributeProto<'a>>>>;

pub struct IncomingSyncOp {
    // sync concerns
    pub base_seq: Option<i64>, // only for snapshots
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
    pub seq: Option<i64>,
    pub base_seq: i64, // snapshot seq base
    pub op_kind: i8,   // TODO: Specify allowable enums
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
    pub seq: i64,
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

pub fn process_op_batch() {}

#[derive(Clone)]
pub struct OpBatchProcessor {
    pub tx: Sender<IncomingSyncOpBatch>,
}

impl OpBatchProcessor {
    pub fn new(ws: &WebsocketState, auth_cache: &AuthCache, db: &Db) -> Self {
        let (tx, rx) = mpsc::channel::<IncomingSyncOpBatch>(100);
        // rx to hook up to batch_processor
        process_batch_ops(rx, ws.clone(), auth_cache.clone(), db.clone());
        Self { tx }
    }
}

async fn process_batch_ops(
    // Uhh but we need access to app state...?
    mut rx: mpsc::Receiver<IncomingSyncOpBatch>,
    ws: WebsocketState,
    auth_cache: AuthCache,
    db: Db,
) {
    while let Some(batch) = rx.recv().await {
        let mut responses: Vec<BatchAction> = Vec::new();
        // TODO: Optimisation: Local cache for batch.user_id?
        for op in batch.ops {
            if auth_cache.check(&db, &batch.user_id, &op.library_id).await == false {
                responses.push(BatchAction::Error {
                    action_id: Some(op.op_id),
                    message: String::from("unauthorised"),
                });
                continue;
            }
            // TODO: 1x transaction for all?!
            let Ok(result) = db.sync_op.apply(&op).await else {
                println!("{e:?}"); // TODO: Telemetry
                responses.push(BatchAction::Error {
                    action_id: Some(op.op_id), // TODO: distinguish op vs action id?!
                    message: String::from("apply_error"),
                });
            };
        }
        // let Ok(result) = db.sync_op.merge_many(&items).await else {};
        // send_to_client(&ws, &batch.socket_id, message).await;
    }
}

// TODO: We might only want a partial interim step not all of this
// impl<'a> TryFrom<SyncOpActionProto<'a>> for SyncOp {
//     type Error = AppError;

//     fn try_from(p: SyncOpActionProto<'a>) -> Result<Self, Self::Error> {
//         Ok(Self {
//             seq: None,
//             base_seq: p.base_seq(), // TODO: Treat 0 as None?
//             op_kind: p.op_kind().0,
//             archived: false,
//             library_id: proto_uuid_to_uuid(p.library_id()),
//             obj_id: proto_uuid_to_uuid(p.obj_id()),
//             obj_kind: p.obj_kind(),
//             path: None, // TODO: Later
//             payload: p.to_owned(),
//             payload_sha256: None,
//             tombstone_utc: None,
//             created_utc: None,
//             client_id: None,
//         })
//     }
// }

// TODO: Keep this?
// impl SyncOp {
//     pub fn from_action_proto(p: &SyncOpActionProto) -> Self {
//         Self {
//             id: proto_uuid_to_uuid(p.id()),
//             library_id: proto_uuid_to_uuid(p.library_id()),
//             seq: None,
//             tombstone_utc: None,
//         }
//     }
// }

// impl<A: SyncAttrs> SyncObject<A> {
//     pub fn from_action_proto(p: &SyncOpActionProto) -> Result<Self, AppError> {
//         let meta = SyncOpMeta::from_action_proto(p);
//         let attrs = A::from_attr_vec(p.attributes())?; // TODO: is this encrypted or not?
//         Ok(SyncObject { meta, attrs })
//     }
// }

#[async_trait]
pub trait SyncOpModel: Send + Sync {
    async fn get_by_id(&self, library_id: &Uuid, id: &Uuid) -> Result<Option<SyncOpSql>, AppError>;
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
    async fn apply(&self, op: &IncomingSyncOp) -> Result<(), AppError>;
    // async fn get_by_id(&self, id: &Uuid) -> Result<Option<Item>, AppError>;
}
