// These are the user defined types!
use crate::{
    common::error::AppError,
    sync_engine::engine::{AttributeFBVec, AttributesBlob, SyncAttrs, SyncObject},
    sync_transport::proto_generated::proto::{
        AttrTypeProto, AttributeProto, AttributeProtoArgs, AttributeSetProto,
        AttributeSetProtoArgs, LWWTimestampProto,
    },
};
use crdt::{LWWRegister, timestamp::LWWTimestamp};
use flatbuffers::FlatBufferBuilder;

pub const ITEM: i16 = 0;

pub mod item_field_id {
    pub const ITEM_TEXT: i16 = 0;
    // TODO: item.type could be an enum (repeat, static, series, shuffle, playlist)
    // TODO: repeat could be a property...
}

#[derive(Debug, Clone)]
pub struct ItemAttrs {
    pub text: Option<LWWRegister<String>>,
}

impl Default for ItemAttrs {
    fn default() -> Self {
        Self { text: None }
    }
}

impl SyncAttrs for ItemAttrs {
    const OBJ_TYPE: i16 = ITEM;

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
        let vec_off = builder.create_vector(&fb_attributes);
        let set_off = AttributeSetProto::create(
            &mut builder,
            &AttributeSetProtoArgs {
                attributes: Some(vec_off),
            },
        );
        builder.finish(set_off, None);
        Ok(builder.finished_data().to_vec())
    }

    fn from_attr_vec<'a>(attr_vec: AttributeFBVec<'a>) -> Result<Self, AppError> {
        let mut attributes = ItemAttrs::default();
        if let Some(attrs) = attr_vec {
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
        Ok(attributes)
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
