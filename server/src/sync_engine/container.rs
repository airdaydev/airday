// These are the user defined types!
use crate::{
    common::error::AppError,
    sync_engine::engine::{AttributesBlob, FromActionProto, SyncAttrs, SyncObject},
    sync_transport::proto_generated::proto::{
        AttrTypeProto, AttributeProto, AttributeProtoArgs, AttributeSetProto,
        AttributeSetProtoArgs, LWWTimestampProto, ObjectTypeProto, SyncObjectActionProto,
    },
};
use crdt::{LWWRegister, timestamp::LWWTimestamp};
use flatbuffers::FlatBufferBuilder;

pub const CONTAINER: i64 = 1;

pub mod container_field_id {
    pub const CONTAINER_NAME: i16 = 256;
    pub const CONTAINER_DESCRIPTION: i16 = 257;
}

#[derive(Debug, Clone)]
pub struct ContainerAttrs {
    pub name: Option<LWWRegister<String>>,
}

impl ContainerAttrs {
    pub fn from_sync_object_proto<'a>(sync_obj_proto: &'a SyncObjectActionProto) -> ContainerAttrs {
        let mut attributes = ContainerAttrs { name: None };
        if let Some(attrs) = sync_obj_proto.attributes() {
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
        attributes
    }
}

impl Default for ContainerAttrs {
    fn default() -> Self {
        Self { name: None }
    }
}

impl SyncAttrs for ContainerAttrs {
    const OBJ_TYPE: i64 = CONTAINER;

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
        let mut attributes = ContainerAttrs::default();

        if let Some(attrs) = attr_set.attributes() {
            for i in 0..attrs.len() {
                let attr = attrs.get(i);
                if attr.field_id() == container_field_id::CONTAINER_NAME
                    && attr.value_type() == AttrTypeProto::STRING
                {
                    if let (Some(s), Some(ts)) = (attr.string(), attr.timestamp()) {
                        attributes.name = Some(LWWRegister {
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

pub type ContainerObject = SyncObject<ContainerAttrs>;

impl FromActionProto for ContainerAttrs {
    fn attrs_from_proto(p: &SyncObjectActionProto) -> Result<Self, AppError> {
        if p.type_() != ObjectTypeProto::Container {
            return Err(AppError::ValidationError("wrong proto type".into()));
        }
        // your existing loop:
        Ok(ContainerAttrs::from_sync_object_proto(p))
    }
}
