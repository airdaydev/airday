// TODO: This will only become relevant if we decide to allow non-e2ee attrs (e.g. in the case of a caldav adapter)
// pub trait SyncAttrs: Sized {
//     const OBJ_KIND: i16;
//     /// Append this struct’s attributes into a FlatBuffers builder.
//     fn to_attr_blob(&self) -> Result<PayloadBlob, AppError>;

//     /// Decode from vector of attributes (db & object action)
//     fn from_attr_vec<'a>(attr_vec: AttributeFBVec<'a>) -> Result<Self, AppError>;
// }

// #[derive(Debug, Clone)]
// pub struct SyncObject<A: SyncAttrs> {
//     pub meta: SyncObjectMeta,
//     pub attrs: A,
// }

// impl<A: SyncAttrs> SyncObject<A> {
//     #[inline]
//     pub fn obj_kind(&self) -> i16 {
//         A::OBJ_KIND
//     }

//     #[inline]
//     pub fn to_attr_blob(&self) -> Result<PayloadBlob, AppError> {
//         self.attrs.to_attr_blob()
//     }

//     #[inline]
//     pub fn merge_attrs(&mut self, other: &A) {
//         self.attrs.merge_into(other);
//     }
// }

// async fn merge(&self, item: &Item) -> Result<(), AppError>;
// async fn merge_many(&self, item: &Vec<AnySyncObject>) -> Result<Vec<Option<i64>>, AppError>;
