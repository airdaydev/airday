// These are the user defined types!
use crate::{
    common::error::AppError,
    sync_engine::engine::{AttributesBlob, SyncAttrs, SyncObject},
    sync_transport::proto_generated::proto::{
        AttrTypeProto, AttributeProto, AttributeProtoArgs, AttributeSetProto,
        AttributeSetProtoArgs, LWWTimestampProto, ObjectTypeProto, SyncObjectActionProto,
    },
};
use crdt::{LWWRegister, timestamp::LWWTimestamp};
use flatbuffers::FlatBufferBuilder;

pub const ITEM: i64 = 0;

pub mod item_field_id {
    pub const ITEM_TEXT: i16 = 0;
    // TODO: item.type could be an enum (repeat, static, series, shuffle, playlist)
    // TODO: repeat could be a property...
}

#[derive(Debug, Clone)]
pub struct ItemAttrs {
    pub text: Option<LWWRegister<String>>,
}

// TODO: ...?
impl ItemAttrs {
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

impl Default for ItemAttrs {
    fn default() -> Self {
        Self { text: None }
    }
}

impl SyncAttrs for ItemAttrs {
    const OBJ_TYPE: i64 = ITEM;

    fn to_attr_blob(&self) -> Result<AttributesBlob, AppError> {
        // Your existing builder logic, just moved here:
        let mut builder = FlatBufferBuilder::new();
        let mut fb_attributes = Vec::new();

        if let Some(text_lww) = &self.text {
            let ts = LWWTimestampProto::new(text_lww.timestamp.utc, text_lww.timestamp.pid);
            let off = builder.create_string(&text_lww.data);
            let attr = AttributeProto::create(
                &mut builder,
                &AttributeProtoArgs {
                    field_id: item_field_id::ITEM_TEXT,
                    value_type: AttrTypeProto::STRING,
                    timestamp: Some(&ts),
                    string: Some(off),
                    bytes: None,
                    i64_fb: 0,
                    f64_fb: 0.0,
                },
            );
            fb_attributes.push(attr);
        }

        if fb_attributes.is_empty() {
            return Ok(None);
        }
        let vec_off = builder.create_vector(&fb_attributes);
        let set_off = AttributeSetProto::create(
            &mut builder,
            &AttributeSetProtoArgs {
                attributes: Some(vec_off),
            },
        );
        builder.finish(set_off, None);
        Ok(Some(builder.finished_data().to_vec()))
    }

    fn from_attr_blob(blob: &[u8]) -> Result<Self, AppError> {
        let attr_set = flatbuffers::root::<AttributeSetProto>(blob).map_err(|e| {
            AppError::ServerError(format!("Failed to parse AttributeSetProto: {}", e))
        })?;
        let mut attributes = ItemAttrs::default();

        if let Some(attrs) = attr_set.attributes() {
            for i in 0..attrs.len() {
                let attr = attrs.get(i);
                if attr.field_id() == item_field_id::ITEM_TEXT
                    && attr.value_type() == AttrTypeProto::STRING
                {
                    if let (Some(s), Some(ts)) = (attr.string(), attr.timestamp()) {
                        attributes.text = Some(LWWRegister {
                            timestamp: LWWTimestamp {
                                utc: ts.utc(),
                                pid: ts.pid(),
                            },
                            data: s.to_string(),
                        });
                    }
                }
            }
        }
        Ok(attributes)
    }

    fn attrs_from_proto(p: &SyncObjectActionProto) -> Result<Self, AppError> {
        if p.type_() != ObjectTypeProto::Item {
            return Err(AppError::ValidationError("wrong proto type".into()));
        }
        // your existing loop:
        Ok(ItemAttrs::from_sync_object_proto(p))
    }

    fn merge_into(&mut self, other: &Self) {
        if let Some(text) = &other.text {
            if let Some(self_text) = &self.text {
                let merged = self_text.clone().merge(text.clone());
                self.text = Some(merged);
            } else {
                self.text = Some(text.clone());
            }
        }
    }
}

pub type ItemObject = SyncObject<ItemAttrs>;
