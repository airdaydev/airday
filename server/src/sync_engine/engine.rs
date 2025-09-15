use crate::{
    common::{error::AppError, utils::proto_uuid_to_uuid},
    sync_transport::proto_generated::proto::{AttributeProto, SyncOpActionProto},
};
use async_trait::async_trait;
use sqlx::prelude::FromRow;
use std::{fmt::Debug, pin::Pin};
use uuid::Uuid;

pub type PayloadBlob = Vec<u8>;
pub type Sha256 = Vec<u8>;

pub type AttributeFBVec<'a> =
    Option<flatbuffers::Vector<'a, flatbuffers::ForwardsUOffset<AttributeProto<'a>>>>;

#[derive(FromRow)]
pub struct SqlSyncOp {
    // sync concerns
    pub seq: i64,
    pub base_seq: i64, // snapshot seq base
    pub op_kind: i64,  // TODO: Specify allowable enums
    pub enc: bool,
    // static attrs
    pub library_id: Uuid,
    pub obj_id: Uuid,
    pub path: Option<i64>,
    pub obj_type: i64,
    // flatbuffer blob (may be encrypted)
    pub payload: PayloadBlob,
    pub payload_sha256: Option<Sha256>,
    // metadata
    pub tombstone_utc: Option<i64>,
    pub created_utc: Option<i64>,
    pub client_id: Option<Uuid>,
}

// TODO: This may no longer be required
#[derive(Debug, Clone)]
pub struct SyncOpMeta {
    pub id: Uuid,
    pub library_id: Uuid,
    pub seq: Option<i64>,
    pub tombstone_utc: Option<i64>,
}

impl SyncOpMeta {
    pub fn from_sql_row(row: &SqlSyncOp) -> SyncOpMeta {
        SyncOpMeta {
            id: row.obj_id,
            library_id: row.library_id,
            seq: Some(row.seq),
            tombstone_utc: row.tombstone_utc,
        }
    }
    pub fn from_action_proto(p: &SyncOpActionProto) -> SyncOpMeta {
        SyncOpMeta {
            id: proto_uuid_to_uuid(p.id()),
            library_id: proto_uuid_to_uuid(p.library_id()),
            seq: None,
            tombstone_utc: None,
        }
    }
}

// impl<A: SyncAttrs> SyncObject<A> {
//     pub fn from_action_proto(p: &SyncOpActionProto) -> Result<Self, AppError> {
//         let meta = SyncOpMeta::from_action_proto(p);
//         let attrs = A::from_attr_vec(p.attributes())?; // TODO: is this encrypted or not?
//         Ok(SyncObject { meta, attrs })
//     }
// }

#[async_trait]
pub trait SyncOpModel: Send + Sync {
    async fn get_by_id(&self, library_id: &Uuid, id: &Uuid) -> Result<Option<SqlSyncOp>, AppError>;
    // Accept query options
    fn get_by_library_stream<'a>(
        &'a self,
        library_id: &Uuid,
        seq: i64,
    ) -> Pin<
        Box<
            dyn futures_util::Stream<Item = Result<SqlSyncOp, sqlx::Error>>
                + std::marker::Send
                + 'a,
        >,
    >;
    // async fn insert(&self, item: &Item) -> Result<(), AppError>;
    // async fn get_by_id(&self, id: &Uuid) -> Result<Option<Item>, AppError>;
}
