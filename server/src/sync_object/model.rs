use crate::{
    common::{error::AppError, utils::proto_uuid_to_uuid},
    sync::proto_generated::proto::{AttrTypeProto, AttributeProto, AttributeProtoArgs, AttributeSetProto, AttributeSetProtoArgs, LWWTimestampProto, ObjectTypeProto, SyncObjectActionProto},
    sync_object::types::item_field_id,
};
use flatbuffers::FlatBufferBuilder;
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
    // Serialize attributes to AttributeSetProto blob
    pub fn get_attributes_blob(&self) -> Result<AttributesBlob, AppError> {
        let mut builder = FlatBufferBuilder::new();
        let mut fb_attributes = Vec::new();

        match self {
            SyncObject::Container { attrs, .. } => {
                if let Some(name_lww) = &attrs.name {
                    let timestamp = LWWTimestampProto::new(name_lww.timestamp.utc, name_lww.timestamp.pid);
                    let name_offset = builder.create_string(&name_lww.data);
                    
                    let attr = AttributeProto::create(&mut builder, &AttributeProtoArgs {
                        field_id: crate::sync_object::types::list_field_id::LIST_NAME,
                        value_type: AttrTypeProto::STRING,
                        timestamp: Some(&timestamp),
                        string: Some(name_offset),
                        bytes: None,
                        i64_fb: 0,
                        f64_fb: 0.0,
                    });
                    fb_attributes.push(attr);
                }
            }
            SyncObject::Item { attrs, .. } => {
                if let Some(text_lww) = &attrs.text {
                    let timestamp = LWWTimestampProto::new(text_lww.timestamp.utc, text_lww.timestamp.pid);
                    let text_offset = builder.create_string(&text_lww.data);
                    
                    let attr = AttributeProto::create(&mut builder, &AttributeProtoArgs {
                        field_id: item_field_id::ITEM_TEXT,
                        value_type: AttrTypeProto::STRING,
                        timestamp: Some(&timestamp),
                        string: Some(text_offset),
                        bytes: None,
                        i64_fb: 0,
                        f64_fb: 0.0,
                    });
                    fb_attributes.push(attr);
                }
            }
        }

        if fb_attributes.is_empty() {
            return Ok(None);
        }

        let attributes_vector = builder.create_vector(&fb_attributes);
        let attr_set = AttributeSetProto::create(&mut builder, &AttributeSetProtoArgs {
            attributes: Some(attributes_vector),
        });
        builder.finish(attr_set, None);
        
        Ok(Some(builder.finished_data().to_vec()))
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
    pub fn from_attributes_blob(blob: &[u8]) -> Result<ItemAttributes, AppError> {
        let attr_set = flatbuffers::root::<AttributeSetProto>(blob)
            .map_err(|e| AppError::ServerError(format!("Failed to parse AttributeSetProto: {}", e)))?;
        
        let mut attributes = ItemAttributes { text: None };
        
        if let Some(attrs) = attr_set.attributes() {
            for i in 0..attrs.len() {
                let attr = attrs.get(i);
                match attr.field_id() {
                    item_field_id::ITEM_TEXT => {
                        if attr.value_type() == AttrTypeProto::STRING {
                            if let Some(text_data) = attr.string() {
                                if let Some(timestamp) = attr.timestamp() {
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
                    }
                    _ => {
                        // TODO: Handle unknown field IDs for custom attributes
                    }
                }
            }
        }
        
        Ok(attributes)
    }

    pub fn from_sync_object_proto<'a>(sync_obj_proto: &'a SyncObjectActionProto) -> ItemAttributes {
        let mut attributes = ItemAttributes { text: None };
        if let Some(attrs) = sync_obj_proto.attributes() {
            for i in 0..attrs.len() {
                let attr = attrs.get(i);
                match attr.field_id() {
                    item_field_id::ITEM_TEXT => {
                        match attr.value_type() {
                            AttrTypeProto::STRING => {
                                if let Some(text_data) = attr.string() {
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
        attributes
    }
}

#[derive(Debug, Clone)]
pub struct ListAttributes {
    pub name: Option<LWWRegister<String>>,
}

impl ListAttributes {
    pub fn from_attributes_blob(blob: &[u8]) -> Result<ListAttributes, AppError> {
        let attr_set = flatbuffers::root::<AttributeSetProto>(blob)
            .map_err(|e| AppError::ServerError(format!("Failed to parse AttributeSetProto: {}", e)))?;
        
        let mut attributes = ListAttributes { name: None };
        
        if let Some(attrs) = attr_set.attributes() {
            for i in 0..attrs.len() {
                let attr = attrs.get(i);
                match attr.field_id() {
                    crate::sync_object::types::list_field_id::LIST_NAME => {
                        if attr.value_type() == AttrTypeProto::STRING {
                            if let Some(name_data) = attr.string() {
                                if let Some(timestamp) = attr.timestamp() {
                                    let name_lww = LWWRegister {
                                        timestamp: LWWTimestamp {
                                            utc: timestamp.utc(),
                                            pid: timestamp.pid(),
                                        },
                                        data: name_data.to_string(),
                                    };
                                    attributes.name = Some(name_lww);
                                }
                            }
                        }
                    }
                    _ => {
                        // TODO: Handle unknown field IDs for custom attributes
                    }
                }
            }
        }
        
        Ok(attributes)
    }

    pub fn from_sync_object_proto<'a>(sync_obj_proto: &'a SyncObjectActionProto) -> ListAttributes {
        let mut attributes = ListAttributes { name: None };
        if let Some(attrs) = sync_obj_proto.attributes() {
            for i in 0..attrs.len() {
                let attr = attrs.get(i);
                match attr.field_id() {
                    crate::sync_object::types::list_field_id::LIST_NAME => {
                        match attr.value_type() {
                            AttrTypeProto::STRING => {
                                if let Some(name_data) = attr.string() {
                                    let timestamp = attr.timestamp().unwrap();
                                    let name_lww = LWWRegister {
                                        timestamp: LWWTimestamp {
                                            utc: timestamp.utc(),
                                            pid: timestamp.pid(),
                                        },
                                        data: name_data.to_string(),
                                    };
                                    attributes.name = Some(name_lww);
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
        attributes
    }
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
                let attrs = ItemAttributes::from_sync_object_proto(sync_obj_proto);
                Ok(SyncObject::Item { meta, attrs })
            }
            ObjectTypeProto::Container => {
                let attrs = ListAttributes::from_sync_object_proto(sync_obj_proto);
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

impl ListAttributes {
    pub fn merge<'a>(&'a mut self, attrs: &ListAttributes) -> &'a ListAttributes {
        // Merging text
        if let Some(name) = &attrs.name {
            if let Some(self_name) = &self.name {
                // case 1: attr does exist, merge via app logic
                // TODO: Ergonomics!
                let lww_a = self_name.clone();
                let lww_b = name.clone();
                let merged = lww_a.merge(lww_b).unwrap();
                self.name = Some(merged);
            } else {
                // case 2: attr doesn't exist on self, replace
                self.name = Some(name.clone());
            }
        }
        // TODO: Repeat for each attribute (after improving ergonomics)
        self
    }
}

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
