use crate::{
    common::error::AppError,
    sync::engine::{AttributeFBVec, AttributesBlob, SyncAttrs},
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
    const OBJ_KIND: i16 = ITEM;

    fn to_attr_blob(&self) -> Result<AttributesBlob, AppError> {
        // Your existing fbb logic, just moved here:
        let mut fbb = FlatBufferBuilder::new();
        let mut fb_attributes = Vec::new();

        if let Some(text_lww) = &self.text {
            let ts = LWWTimestampProto::new(text_lww.timestamp.utc, text_lww.timestamp.pid);
            let off = fbb.create_string(&text_lww.data);
            let attr = AttributeProto::create(
                &mut fbb,
                &AttributeProtoArgs {
                    field_id: item_field_id::ITEM_TEXT,
                    value_type: AttrTypeProto::STRING,
                    timestamp: Some(&ts),
                    string: Some(off),
                    bytes: None,
                    i64_fb: 0,
                    f64_fb: 0.0,
                    bool: false,
                    clear: false,
                },
            );
            fb_attributes.push(attr);
        }
        let vec_off = fbb.create_vector(&fb_attributes);
        let set_off = AttributeSetProto::create(
            &mut fbb,
            &AttributeSetProtoArgs {
                attributes: Some(vec_off),
            },
        );
        fbb.finish(set_off, None);
        Ok(fbb.finished_data().to_vec())
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
