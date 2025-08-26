use crate::{common::error::AppError, sync::proto_generated::proto};

/// Object kind (enum discriminant) for dispatch, storage & filtering
pub trait SyncKind {
    /// Stable, app-wide integer for this object kind.
    const KIND_ID: i64;
    /// Semantic name
    const NAME: &'static str;
}

/// Field-level encoding to/from your AttributeSetProto.
pub trait AttrCodec {
    /// Append this struct’s attributes into a FlatBuffers builder.
    fn encode_attrs(
        &self,
        fbb: &mut flatbuffers::FlatBufferBuilder<'_>,
        out: &mut Vec<flatbuffers::WIPOffset<proto::AttributeProto<'_>>>,
    );

    /// Decode from a full AttributeSetProto into Self (partial allowed).
    fn decode_attrs(attr_set: &proto::AttributeSetProto<'_>) -> Self;

    /// Merge field-by-field (LWW, union, min/max, etc.)
    fn merge_into(&mut self, other: &Self);
}

/// A registry-facing type-erased view for dynamic dispatch
pub trait DynSyncObject: Send + Sync {
    fn kind_id(&self) -> i64;
    fn get_attributes_blob(&self) -> Result<Option<Vec<u8>>, AppError>;
    fn merge_from_blob(&mut self, blob: &[u8]) -> Result<(), AppError>;
}
