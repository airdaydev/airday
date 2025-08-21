use crate::{
    common::{error::AppError, utils::proto_uuid_to_uuid},
    sync::proto_generated::proto::{FieldValueProto, ObjectTypeProto, SyncObjectActionProto},
    sync_object::types::item_field_id,
};
use async_trait::async_trait;
use crdt::LWWRegister;
use crdt::timestamp::LWWTimestamp;
use serde::{Deserialize, Serialize};
use sqlx::prelude::FromRow;
use std::pin::Pin;
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
struct LWWDefinitionJson<T> {
    utc: i64,
    pid: i64,
    data: T,
}

impl<T: Clone> LWWDefinitionJson<T> {
    pub fn to_lww(&self) -> LWWRegister<T> {
        let timestamp = LWWTimestamp {
            utc: self.utc,
            pid: self.pid,
        };
        LWWRegister {
            timestamp,
            data: self.data.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub enum SyncObject {
    Item {
        meta: SyncObjectMeta,
        attrs: ItemAttributes,
    },
    Container {
        meta: SyncObjectMeta,
        attrs: ListAttributes,
    },
    // TODO: Expose sync engine type defs via macros
    // TODO: Dynamic types
}

impl SyncObject {
    pub fn get_meta(&self) -> &SyncObjectMeta {
        match self {
            SyncObject::Container { meta, .. } => meta,
            SyncObject::Item { meta, .. } => meta,
        }
    }
    // TODO: Make direct functions on the attributes themselves
    pub fn get_attributes_json(&self) -> Result<JsonAttributes, AppError> {
        match self {
            SyncObject::Container { attrs, .. } => {
                let mut json_attrs = ListAttributesJson { name: None };
                if let Some(name_lww) = &attrs.name {
                    json_attrs.name = Some(LWWDefinitionJson {
                        utc: name_lww.timestamp.utc,
                        pid: name_lww.timestamp.pid,
                        data: name_lww.data.clone(),
                    })
                }
                let json_value = serde_json::to_value(json_attrs).map_err(|err| {
                    AppError::ServerError(format!("Failed to serialize attributes: {}", err))
                })?;

                Ok(Some(json_value))
            }
            SyncObject::Item { attrs, .. } => {
                let mut json_attrs = ItemAttributesJson { text: None };

                if let Some(text_lww) = &attrs.text {
                    json_attrs.text = Some(LWWDefinitionJson {
                        utc: text_lww.timestamp.utc,
                        pid: text_lww.timestamp.pid,
                        data: text_lww.data.clone(),
                    });
                }

                let json_value = serde_json::to_value(json_attrs).map_err(|err| {
                    AppError::ServerError(format!("Failed to serialize attributes: {}", err))
                })?;

                Ok(Some(json_value))
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct SyncObjectMeta {
    pub id: Uuid,
    pub library_id: Uuid,
    pub server_seq: Option<i64>,
    pub tombstone_utc: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ItemAttributes {
    pub text: Option<LWWRegister<String>>,
}

impl ItemAttributes {
    pub fn from_sync_object_proto<'a>(sync_obj_proto: &'a SyncObjectActionProto) {
        let mut attributes = ItemAttributes { text: None };
        if let Some(attrs) = sync_obj_proto.attributes() {
            for i in 0..attrs.len() {
                let attr = attrs.get(i);
                match attr.field_id() {
                    item_field_id::ITEM_TEXT => {
                        match attr.value_type() {
                            FieldValueProto::StringValueProto => {
                                if let Some(string_val) = attr.value_as_string_value_proto() {
                                    if let Some(text_data) = string_val.v() {
                                        let timestamp = attr.timestamp().unwrap();
                                        let text_lww = LWWRegister {
                                            timestamp: LWWTimestamp {
                                                utc: timestamp.utc(),
                                                pid: timestamp.pid(),
                                            },
                                            data: text_data.to_string(),
                                        };
                                        attributes.text = Some(text_lww);
                                    }
                                }
                            }
                            _ => {
                                // Ignore mistyped field, but consider adding err to span
                            }
                        }
                    }
                    _ => {
                        // TODO: Ignore unknown value, but later used for custom attribute values
                    }
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct ListAttributes {
    pub name: Option<LWWRegister<String>>,
}

impl SyncObject {
    pub fn from_sync_object_proto<'a>(
        sync_obj_proto: &'a SyncObjectActionProto,
    ) -> Result<SyncObject, AppError> {
        let meta = SyncObjectMeta {
            id: proto_uuid_to_uuid(sync_obj_proto.id()),
            library_id: proto_uuid_to_uuid(sync_obj_proto.library_id()),
            server_seq: None, // Because these are coming from the client, typically
            tombstone_utc: None,
            // tombstone_utc: Some(sync_obj_proto.tombstone()), so if it's 0 we can ignore it safely, right?
        };
        return match sync_obj_proto.type_() {
            ObjectTypeProto::Item => {
                let attrs = ItemAttributes { text: None };
                Ok(SyncObject::Item { meta, attrs })
            }
            ObjectTypeProto::Container => {
                let attrs = ListAttributes { name: None };
                Ok(SyncObject::Container { meta, attrs })
            }
            _ => Err(AppError::ValidationError(String::from(
                "SyncObjectType not found",
            ))),
        };
    }
}

impl From<ItemAttributesJson> for ItemAttributes {
    fn from(attr_json: ItemAttributesJson) -> ItemAttributes {
        let mut attrs = ItemAttributes { text: None };
        if let Some(text) = attr_json.text {
            attrs.text = Some(text.to_lww())
        }
        attrs
    }
}

impl From<ListAttributesJson> for ListAttributes {
    fn from(attr_json: ListAttributesJson) -> ListAttributes {
        let mut attrs = ListAttributes { name: None };
        if let Some(name) = attr_json.name {
            attrs.name = Some(name.to_lww())
        }
        attrs
    }
}

#[derive(sqlx::FromRow, Deserialize, Serialize)]
pub struct ItemAttributesJson {
    text: Option<LWWDefinitionJson<String>>,
}

#[derive(sqlx::FromRow, Deserialize, Serialize)]
pub struct ListAttributesJson {
    name: Option<LWWDefinitionJson<String>>,
}

impl ItemAttributes {
    pub fn merge<'a>(&'a mut self, attrs: &ItemAttributes) -> &'a ItemAttributes {
        // Merging text
        if let Some(text) = &attrs.text {
            if let Some(self_text) = &self.text {
                // case 1: attr does exist, merge via app logic
                // TODO: Ergonomics!
                let lww_a = self_text.clone();
                let lww_b = text.clone();
                let merged = lww_a.merge(lww_b).unwrap();
                self.text = Some(merged);
            } else {
                // case 2: attr doesn't exist on self, replace
                self.text = Some(text.clone());
            }
        }
        // TODO: Repeat for each attribute (after improving ergonomics)
        self
    }
}

pub type JsonAttributes = Option<serde_json::Value>;

#[derive(FromRow)]
pub struct SqlSyncObject {
    // static attrs
    pub id: Uuid,
    pub obj_type: i64,
    pub library_id: Uuid,
    // dynamic attrs (lww-map)
    pub attributes: JsonAttributes,
    // metadata
    pub server_seq: i64,
    pub tombstone_utc: Option<i64>,
}

// TODO: Implement Item * Item from SqlSyncObject (Maybe?)
// pub struct Item {
//     pub id: Uuid,
//     pub library_id: Uuid,
//     pub text: Option<LWWRegister<>>,
// }

// impl From<SqlSyncObject> for Item {
//     fn from(sql_item: SqlSyncObject) -> Self {
//         Self {
//             id: sql_item.id,
//             // TODO: back and forth between json type
//             // text: LWWRegister<>::from_string(String::from("Test")),
//         }
//     }
// }

#[async_trait]
pub trait SyncObjectModel: Send + Sync {
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
    async fn merge_many(&self, item: &Vec<SyncObject>) -> Result<Vec<Option<i64>>, AppError>;
    // async fn insert(&self, item: &Item) -> Result<(), AppError>;
    // async fn get_by_id(&self, id: &Uuid) -> Result<Option<Item>, AppError>;
}
