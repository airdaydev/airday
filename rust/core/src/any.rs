use crate::{
    common::error::AppError,
    sync_engine::{
        container::{CONTAINER, ContainerAttrs},
        engine::{AttributesBlob, SqlSyncObject, SyncAttrs, SyncObject, SyncObjectMeta},
        item::{ITEM, ItemAttrs},
    },
    sync_transport::proto_generated::proto::{AttributeSetProto, SyncOpActionProto},
};

#[derive(Debug, Clone)]
pub enum AnySyncObject {
    Item(SyncObject<ItemAttrs>),
    Container(SyncObject<ContainerAttrs>),
}

impl TryFrom<SqlSyncObject> for AnySyncObject {
    type Error = AppError;

    fn try_from(row: SqlSyncObject) -> Result<Self, Self::Error> {
        let meta = SyncObjectMeta::from_sql_row(&row);
        let root = flatbuffers::root::<AttributeSetProto>(&row.attributes).map_err(|e| {
            AppError::ServerError(format!("Failed to parse AttributeSetProto: {}", e))
        })?;

        match row.obj_type {
            x if x == ITEM as i64 => {
                let attrs = ItemAttrs::from_attr_vec(root.attributes())?;
                Ok(AnySyncObject::Item(SyncObject { meta, attrs }))
            }
            x if x == CONTAINER as i64 => {
                let attrs = ContainerAttrs::from_attr_vec(root.attributes())?;
                Ok(AnySyncObject::Container(SyncObject { meta, attrs }))
            }
            _ => Err(AppError::DatabaseError("Unknown object type".into())),
        }
    }
}

impl<'a> TryFrom<SyncOpActionProto<'a>> for AnySyncObject {
    type Error = AppError;

    fn try_from(p: SyncOpActionProto<'a>) -> Result<Self, Self::Error> {
        let meta = SyncObjectMeta::from_action_proto(&p);
        p.attributes();

        match p.obj_type() {
            x if x == ITEM => {
                let attrs = ItemAttrs::from_attr_vec(p.attributes())?;
                Ok(AnySyncObject::Item(SyncObject { meta, attrs }))
            }
            x if x == CONTAINER => {
                let attrs = ContainerAttrs::from_attr_vec(p.attributes())?;
                Ok(AnySyncObject::Container(SyncObject { meta, attrs }))
            }
            _ => Err(AppError::ValidationError("Unknown object type".into())),
        }
    }
}

impl AnySyncObject {
    pub fn meta(&self) -> &SyncObjectMeta {
        match self {
            AnySyncObject::Item(o) => &o.meta,
            AnySyncObject::Container(o) => &o.meta,
        }
    }
    pub fn obj_type(&self) -> i16 {
        match self {
            AnySyncObject::Item(o) => o.obj_type(),
            AnySyncObject::Container(o) => o.obj_type(),
        }
    }
    pub fn to_attr_blob(&self) -> Result<AttributesBlob, AppError> {
        match self {
            AnySyncObject::Item(o) => o.to_attr_blob(),
            AnySyncObject::Container(o) => o.to_attr_blob(),
        }
    }
    pub fn merge_into(&mut self, other: &AnySyncObject) -> Result<(), AppError> {
        match (self, other) {
            (AnySyncObject::Item(a), AnySyncObject::Item(b)) => {
                a.attrs.merge_into(&b.attrs);
                Ok(())
            }
            (AnySyncObject::Container(a), AnySyncObject::Container(b)) => {
                a.attrs.merge_into(&b.attrs);
                Ok(())
            }
            _ => Err(AppError::ValidationError("wrong variant on merge".into())),
        }
    }
}

// convenience helpers
pub fn decode_rows<I>(rows: I) -> Result<Vec<AnySyncObject>, AppError>
where
    I: IntoIterator<Item = SqlSyncObject>,
{
    rows.into_iter().map(AnySyncObject::try_from).collect()
}

// streaming adapter
pub fn map_stream_to_any<S>(
    s: S,
) -> impl futures_util::Stream<Item = Result<AnySyncObject, AppError>>
where
    S: futures_util::Stream<Item = Result<SqlSyncObject, sqlx::Error>>,
{
    use futures_util::TryStreamExt;
    s.map_err(AppError::from)
        .and_then(|row| async move { AnySyncObject::try_from(row) })
}
