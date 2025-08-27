use sqlx::prelude::FromRow;
use uuid::Uuid;

// This is some indirection required for cases where we need to store Vecs of SyncObjects generically
// TODO: Procmacro target
use crate::{
    common::error::AppError,
    sync_engine::{
        container::{CONTAINER, ContainerAttrs},
        engine::{SyncObject, SyncObjectMeta},
        item::{ITEM, ItemAttrs},
    },
};

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

// TODO: Procmacro target from here
#[derive(Debug, Clone)]
pub enum AnySyncObject {
    Item(SyncObject<ItemAttrs>),
    Container(SyncObject<ContainerAttrs>),
}

impl TryFrom<SqlSyncObject> for AnySyncObject {
    type Error = AppError;

    fn try_from(row: SqlSyncObject) -> Result<Self, Self::Error> {
        let meta = SyncObjectMeta {
            id: row.id,
            library_id: row.library_id,
            server_seq: Some(row.server_seq),
            tombstone_utc: row.tombstone_utc,
        };

        match row.obj_type {
            x if x == ITEM => {
                let attrs = if let Some(b) = &row.attributes {
                    ItemAttrs::from_attr_blob(b)?
                } else {
                    ItemAttrs::default()
                };
                Ok(AnySyncObject::Item(SyncObject { meta, attrs }))
            }
            x if x == CONTAINER => {
                let attrs = if let Some(b) = &row.attributes {
                    ContainerAttrs::from_attr_blob(b)?
                } else {
                    ContainerAttrs::default()
                };
                Ok(AnySyncObject::Container(SyncObject { meta, attrs }))
            }
            _ => Err(AppError::DatabaseError("Unknown object type".into())),
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
