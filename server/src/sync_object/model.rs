use crate::{
    common::{error::AppError, utils::proto_uuid_to_uuid},
    sync::proto_generated::proto::{
        AttrTypeProto, AttributeProto, AttributeProtoArgs, AttributeSetProto,
        AttributeSetProtoArgs, LWWTimestampProto, ObjectTypeProto, SyncObjectActionProto,
    },
    sync_object::types::{item_field_id, sync_object_type},
};
use async_trait::async_trait;
use crdt::LWWRegister;
use crdt::timestamp::LWWTimestamp;
use flatbuffers::FlatBufferBuilder;
use sqlx::prelude::FromRow;
use std::pin::Pin;
use uuid::Uuid;

// TODO: Start with user defined SyncObject::<type> macro & determine everything via macro

#[derive(Debug, Clone)]
pub enum SyncObjectAttrs {
    Item(ItemAttrs),
    Container(ContainerAttrs),
}

#[derive(Debug, Clone)]
pub struct SyncObject {
    pub meta: SyncObjectMeta,
    pub attrs: SyncObjectAttrs,
    // TODO: Expose sync engine type defs via macros?
    // TODO: Dynamic types?
}

impl SyncObjectAttrs {
    // Serialize attributes to AttributeSetProto blob
    pub fn get_attributes_blob(&self) -> Result<AttributesBlob, AppError> {
        let mut builder = FlatBufferBuilder::new();
        let mut fb_attributes = Vec::new();

        match self {
            SyncObjectAttrs::Container(val) => {
                if let Some(name_lww) = &val.name {
                    let timestamp =
                        LWWTimestampProto::new(name_lww.timestamp.utc, name_lww.timestamp.pid);
                    let name_offset = builder.create_string(&name_lww.data);

                    let attr = AttributeProto::create(
                        &mut builder,
                        &AttributeProtoArgs {
                            field_id: crate::sync_object::types::list_field_id::LIST_NAME,
                            value_type: AttrTypeProto::STRING,
                            timestamp: Some(&timestamp),
                            string: Some(name_offset),
                            bytes: None,
                            i64_fb: 0,
                            f64_fb: 0.0,
                        },
                    );
                    fb_attributes.push(attr);
                }
            }
            SyncObjectAttrs::Item(val) => {
                if let Some(text_lww) = &val.text {
                    let timestamp =
                        LWWTimestampProto::new(text_lww.timestamp.utc, text_lww.timestamp.pid);
                    let text_offset = builder.create_string(&text_lww.data);

                    let attr = AttributeProto::create(
                        &mut builder,
                        &AttributeProtoArgs {
                            field_id: item_field_id::ITEM_TEXT,
                            value_type: AttrTypeProto::STRING,
                            timestamp: Some(&timestamp),
                            string: Some(text_offset),
                            bytes: None,
                            i64_fb: 0,
                            f64_fb: 0.0,
                        },
                    );
                    fb_attributes.push(attr);
                }
            }
        }

        if fb_attributes.is_empty() {
            return Ok(None);
        }

        let attributes_vector = builder.create_vector(&fb_attributes);
        let attr_set = AttributeSetProto::create(
            &mut builder,
            &AttributeSetProtoArgs {
                attributes: Some(attributes_vector),
            },
        );
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
pub struct ItemAttrs {
    pub text: Option<LWWRegister<String>>,
}

impl ItemAttrs {
    pub fn from_attributes_blob(blob: &[u8]) -> Result<ItemAttrs, AppError> {
        let attr_set = flatbuffers::root::<AttributeSetProto>(blob).map_err(|e| {
            AppError::ServerError(format!("Failed to parse AttributeSetProto: {}", e))
        })?;

        let mut attributes = ItemAttrs { text: None };

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

    pub fn from_sync_object_proto<'a>(sync_obj_proto: &'a SyncObjectActionProto) -> ItemAttrs {
        let mut attributes = ItemAttrs { text: None };
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
pub struct ContainerAttrs {
    pub name: Option<LWWRegister<String>>,
}

impl ContainerAttrs {
    pub fn from_attributes_blob(blob: &[u8]) -> Result<ContainerAttrs, AppError> {
        let attr_set = flatbuffers::root::<AttributeSetProto>(blob).map_err(|e| {
            AppError::ServerError(format!("Failed to parse AttributeSetProto: {}", e))
        })?;

        let mut attributes = ContainerAttrs { name: None };

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

    pub fn from_sync_object_proto<'a>(sync_obj_proto: &'a SyncObjectActionProto) -> ContainerAttrs {
        let mut attributes = ContainerAttrs { name: None };
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
                let attrs =
                    SyncObjectAttrs::Item(ItemAttrs::from_sync_object_proto(sync_obj_proto));
                Ok(SyncObject { meta, attrs })
            }
            ObjectTypeProto::Container => {
                let attrs = SyncObjectAttrs::Container(ContainerAttrs::from_sync_object_proto(
                    sync_obj_proto,
                ));
                Ok(SyncObject { meta, attrs })
            }
            _ => Err(AppError::ValidationError(String::from(
                "SyncObjectType not found",
            ))),
        };
    }
}

pub fn sql_sync_to_sync_object(sql_sync_object: &SqlSyncObject) -> Result<SyncObject, AppError> {
    let meta = SyncObjectMeta {
        id: sql_sync_object.id,
        library_id: sql_sync_object.library_id,
        server_seq: Some(sql_sync_object.server_seq),
        tombstone_utc: sql_sync_object.tombstone_utc,
    };
    let sync_object_attrs: SyncObjectAttrs = match sql_sync_object.obj_type {
        sync_object_type::ITEM => {
            let attrs: ItemAttrs = if let Some(blob) = &sql_sync_object.attributes {
                ItemAttrs::from_attributes_blob(blob)?
            } else {
                ItemAttrs { text: None }
            };
            SyncObjectAttrs::Item(attrs)
        }
        sync_object_type::CONTAINER => {
            let attrs: ContainerAttrs = if let Some(blob) = &sql_sync_object.attributes {
                ContainerAttrs::from_attributes_blob(blob)?
            } else {
                ContainerAttrs { name: None }
            };
            SyncObjectAttrs::Container(attrs)
        }
        _ => return Err(AppError::DatabaseError(String::from("Unknown object type"))),
    };
    let sync_object = SyncObject {
        meta,
        attrs: sync_object_attrs,
    };
    Ok(sync_object)
}

impl ItemAttrs {
    pub fn merge<'a>(&'a mut self, attrs: &ItemAttrs) -> &'a ItemAttrs {
        // Merging text
        if let Some(text) = &attrs.text {
            if let Some(self_text) = &self.text {
                // case 1: attr does exist, merge via app logic
                // TODO: Ergonomics!
                let lww_a = self_text.clone();
                let lww_b = text.clone();
                let merged = lww_a.merge(lww_b);
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

impl ContainerAttrs {
    pub fn merge<'a>(&'a mut self, attrs: &ContainerAttrs) -> &'a ContainerAttrs {
        // Merging text
        if let Some(name) = &attrs.name {
            if let Some(self_name) = &self.name {
                // case 1: attr does exist, merge via app logic
                // TODO: Ergonomics!
                let lww_a = self_name.clone();
                let lww_b = name.clone();
                let merged = lww_a.merge(lww_b);
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

impl SyncObjectAttrs {
    pub fn merge<'a>(&'a mut self, other: &SyncObjectAttrs) -> Result<(), AppError> {
        match (self, other) {
            (SyncObjectAttrs::Item(self_attrs), SyncObjectAttrs::Item(other_attrs)) => {
                self_attrs.merge(other_attrs);
                Ok(())
            }
            (SyncObjectAttrs::Container(self_attrs), SyncObjectAttrs::Container(other_attrs)) => {
                self_attrs.merge(other_attrs);
                Ok(())
            }
            _ => Err(AppError::ValidationError(String::from(
                "wrong variant on merge",
            ))),
        }
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
    async fn get_by_id(&self, library_id: &Uuid, id: &Uuid)
    -> Result<Option<SyncObject>, AppError>;
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
