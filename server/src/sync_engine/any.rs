use crate::{
    common::error::AppError,
    sync_engine::{
        container::{CONTAINER, ContainerAttrs},
        engine::{SqlSyncObject, SyncAttrs, SyncObject, SyncObjectMeta},
        item::{ITEM, ItemAttrs},
    },
};
// This is some indirection required for cases where we need to store Vecs of SyncObjects generically
// TODO: Procmacro target

// TODO: Procmacro target from here
#[derive(Debug, Clone)]
pub enum AnySyncObject {
    Item(SyncObject<ItemAttrs>),
    Container(SyncObject<ContainerAttrs>),
}

impl TryFrom<SqlSyncObject> for AnySyncObject {
    type Error = AppError;

    fn try_from(row: SqlSyncObject) -> Result<Self, Self::Error> {
        let meta = SyncObjectMeta::from_sql_row(&row);

        match row.obj_type {
            x if x == ITEM => {
                let attrs = ItemAttrs::from_attr_blob(&row.attributes)?;
                Ok(AnySyncObject::Item(SyncObject { meta, attrs }))
            }
            x if x == CONTAINER => {
                let attrs = ContainerAttrs::from_attr_blob(&row.attributes)?;
                Ok(AnySyncObject::Container(SyncObject { meta, attrs }))
            }
            _ => Err(AppError::DatabaseError("Unknown object type".into())),
        }
    }
}

impl AnySyncObject {
    pub fn meta(&self) -> SyncObjectMeta {
        match self {
            AnySyncObject::Item(o) => o.meta.clone(),
            AnySyncObject::Container(o) => o.meta.clone(),
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
