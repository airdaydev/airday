// use crate::common::error::AppError;
use crate::sync::proto_generated::proto;
use sync_macros::{SyncObject, sync_objects}

// // TODO: Attempt to implement trait versions
pub trait SyncType {
    const TYPE_ID: i64; // 'puter ID
    const NAME: &'static str; // Friendly name
}

pub trait AttrCodec: Sized {
    fn encode_attrs(
        &self,
        fbb: &mut flatbuffers::FlatBufferBuilder<'_>,
        out: &mut Vec<flatbuffers::WIPOffset<proto::AttributeProto<'_>>>,
    );
    fn decode_attrs(attr_set: &proto::AttributeSetProto<'_>) -> Self;
    fn merge_into(&mut self, other: &Self);
}

pub trait DynSyncObject: Send + Sync {
    fn type_id(&self) -> i64;
    fn get_attributes_blob(&self) -> Result<Option<Vec<u8>>, AppError>;
    fn merge_from_blob(&mut self, blob: &[u8]) -> Result<(), AppError>;
}

pub type Lww<T> = ::crdt::LWWRegister<T>;

#[derive(SyncObject)]
#[sync_object(kind_id = 0, name = "Item")]
pub struct Item {
    #[sync_attr(id = 0, ty = "string")]
    pub text: Option<Lww<String>>,
    #[sync_attr(id = 1, ty = "i64")]
    pub priority: Option<Lww<i64>>,
}

#[derive(SyncObject)]
#[sync_object(kind_id = 1, name = "Container")]
pub struct Container {
    #[sync_attr(id = 256, ty = "string")]
    pub name: Option<Lww<String>>,
}

// Build your super-enum used by the engine
sync_objects! { Item, Container }
