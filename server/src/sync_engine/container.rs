use crate::{
    common::error::AppError,
    sync_engine::engine::{AttributeFBVec, AttributesBlob, SyncAttrs},
    sync_transport::proto_generated::proto::{
        AttrTypeProto, AttributeProto, AttributeProtoArgs, AttributeSetProto,
        AttributeSetProtoArgs, LWWTimestampProto,
    },
};
use crdt::{LWWRegister, timestamp::LWWTimestamp};
use flatbuffers::FlatBufferBuilder;

pub const CONTAINER: i16 = 1;

pub mod container_field_id {
    pub const CONTAINER_NAME: i16 = 256;
}

#[derive(Debug, Clone)]
pub struct ContainerAttrs {
    pub name: Option<LWWRegister<String>>,
}

impl Default for ContainerAttrs {
    fn default() -> Self {
        Self { name: None }
    }
}

impl SyncAttrs for ContainerAttrs {
    const OBJ_TYPE: i16 = CONTAINER;

    fn to_attr_blob(&self) -> Result<AttributesBlob, AppError> {
        // Your existing builder logic, just moved here:
        let mut builder = FlatBufferBuilder::new();
        let mut fb_attributes = Vec::new();

        if let Some(name_lww) = &self.name {
            let ts = LWWTimestampProto::new(name_lww.timestamp.utc, name_lww.timestamp.pid);
            let off = builder.create_string(&name_lww.data);
            let attr = AttributeProto::create(
                &mut builder,
                &AttributeProtoArgs {
                    field_id: container_field_id::CONTAINER_NAME,
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
        let mut attributes = ContainerAttrs::default();
        if let Some(attrs) = attr_vec {
            for i in 0..attrs.len() {
                let attr = attrs.get(i);
                match attr.field_id() {
                    container_field_id::CONTAINER_NAME => {
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
        Ok(attributes)
    }

    fn merge_into(&mut self, other: &Self) {
        if let Some(name) = &other.name {
            if let Some(self_name) = &self.name {
                let merged = self_name.clone().merge(name.clone());
                self.name = Some(merged);
            } else {
                self.name = Some(name.clone());
            }
        }
    }
}
