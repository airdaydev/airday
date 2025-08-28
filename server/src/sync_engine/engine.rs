use crate::{
    common::{error::AppError, utils::proto_uuid_to_uuid},
    sync_engine::any::AnySyncObject,
    sync_transport::proto_generated::proto::SyncObjectActionProto,
};
use async_trait::async_trait;
use sqlx::prelude::FromRow;
use std::{fmt::Debug, pin::Pin};
use uuid::Uuid;

pub type AttributesBlob = Option<Vec<u8>>;

#[derive(FromRow)]
pub struct SqlSyncObject {
    // static attrs
    pub id: Uuid,
    pub obj_type: i64,
    pub library_id: Uuid,
    // dynamic attrs (flatbuffer blob)
    pub attributes: AttributesBlob,
    // metadata
    pub server_seq: i64,
    pub tombstone_utc: Option<i64>,
}

pub trait SyncAttrs: Sized {
    const OBJ_TYPE: i64;
    /// Append this struct’s attributes into a FlatBuffers builder.
    fn to_attr_blob(&self) -> Result<AttributesBlob, AppError>;

    /// Decode from a full AttributeSetProto into Self (partial allowed).
    fn from_attr_blob(blob: &[u8]) -> Result<Self, AppError>;

    /// Merge field-by-field (LWW, union, min/max, etc.)
    fn merge_into(&mut self, other: &Self);

    /// Validate the proto type and extract this A
    fn attrs_from_proto(p: &SyncObjectActionProto) -> Result<Self, AppError>;
}

#[derive(Debug, Clone)]
pub struct SyncObjectMeta {
    pub id: Uuid,
    pub library_id: Uuid,
    pub server_seq: Option<i64>,
    pub tombstone_utc: Option<i64>,
}

impl SyncObjectMeta {
    pub fn from_sql_row(row: &SqlSyncObject) -> SyncObjectMeta {
        SyncObjectMeta {
            id: row.id,
            library_id: row.library_id,
            server_seq: Some(row.server_seq),
            tombstone_utc: row.tombstone_utc,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SyncObject<A: SyncAttrs> {
    pub meta: SyncObjectMeta,
    pub attrs: A,
}

impl<A: SyncAttrs> SyncObject<A> {
    #[inline]
    pub fn obj_type(&self) -> i64 {
        A::OBJ_TYPE
    }

    #[inline]
    pub fn to_attr_blob(&self) -> Result<AttributesBlob, AppError> {
        self.attrs.to_attr_blob()
    }

    #[inline]
    pub fn merge_attrs(&mut self, other: &A) {
        self.attrs.merge_into(other);
    }
}

impl<A: SyncAttrs> SyncObject<A> {
    pub fn from_action_proto(p: &SyncObjectActionProto) -> Result<Self, AppError> {
        let meta = SyncObjectMeta {
            id: proto_uuid_to_uuid(p.id()),
            library_id: proto_uuid_to_uuid(p.library_id()),
            server_seq: None,
            tombstone_utc: None,
        };
        let attrs = A::attrs_from_proto(p)?;
        Ok(SyncObject { meta, attrs })
    }
}

#[async_trait]
pub trait SyncObjectModel: Send + Sync {
    async fn get_by_id(
        &self,
        library_id: &Uuid,
        id: &Uuid,
    ) -> Result<Option<AnySyncObject>, AppError>;
    // Accept query options
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
    >;
    // async fn merge(&self, item: &Item) -> Result<(), AppError>;
    async fn merge_many(&self, item: &Vec<AnySyncObject>) -> Result<Vec<Option<i64>>, AppError>;
    // async fn insert(&self, item: &Item) -> Result<(), AppError>;
    // async fn get_by_id(&self, id: &Uuid) -> Result<Option<Item>, AppError>;
}
