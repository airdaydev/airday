use crate::{
    common::{error::AppError, utils::proto_uuid_to_uuid},
    sync::proto_generated::proto::SyncObjectActionProto,
};
use std::fmt::Debug;
use uuid::Uuid;

pub type AttributesBlob = Option<Vec<u8>>;

pub trait SyncAttrs: Sized {
    const OBJ_TYPE: i64;
    /// Append this struct’s attributes into a FlatBuffers builder.
    fn to_attr_blob(&self) -> Result<AttributesBlob, AppError>;

    /// Decode from a full AttributeSetProto into Self (partial allowed).
    fn from_attr_blob(blob: &[u8]) -> Result<Self, AppError>;

    /// Merge field-by-field (LWW, union, min/max, etc.)
    fn merge_into(&mut self, other: &Self);
}

#[derive(Debug, Clone)]
pub struct SyncObjectMeta {
    pub id: Uuid,
    pub library_id: Uuid,
    pub server_seq: Option<i64>,
    pub tombstone_utc: Option<i64>,
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

pub trait FromActionProto: Sized {
    /// Validate the proto type and extract this A
    fn attrs_from_proto(p: &SyncObjectActionProto) -> Result<Self, AppError>;
}

impl<A: SyncAttrs + FromActionProto> SyncObject<A> {
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
