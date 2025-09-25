use crate::sync::proto_generated::proto::{
    ActionProto, BatchComponentProto, BatchComponentProtoArgs, BatchResponseProto,
    BatchResponseProtoArgs, BatchResponseProtoBuilder, UuidProto,
};
use flatbuffers::{FlatBufferBuilder, WIPOffset};
use uuid::Uuid;

pub enum BatchResponse {
    Applied {
        op_id: Uuid,
        seq: i64,
    },
    Error {
        op_id: Option<Uuid>,
        message: String,
    },
}

impl BatchResponse {
    pub fn build_flatbuffer<'a>(
        &self,
        fbb: &mut FlatBufferBuilder<'a>,
    ) -> WIPOffset<BatchComponentProto<'a>> {
        let offset;
        match self {
            BatchResponse::Applied { op_id, seq } => {
                let id_proto = UuidProto::new(op_id.as_bytes());
                let union_offset = BatchResponseProto::create(
                    fbb,
                    &BatchResponseProtoArgs {
                        success: true,
                        error: None,
                        seq: *seq,
                    },
                )
                .as_union_value();
                offset = BatchComponentProto::create(
                    fbb,
                    &BatchComponentProtoArgs {
                        op_id: Some(&id_proto),
                        action_type: ActionProto::BatchResponseProto,
                        action: Some(union_offset),
                    },
                );
            }
            BatchResponse::Error { op_id, message } => {
                let err_message = fbb.create_string(message);
                let id_proto;
                let op_id = match op_id {
                    Some(op_id) => {
                        id_proto = UuidProto::new(op_id.as_bytes());
                        Some(&id_proto)
                    }
                    None => None,
                };
                let mut err_fbb = BatchResponseProtoBuilder::new(fbb);
                err_fbb.add_success(false);
                err_fbb.add_error(err_message);
                let union_offset = err_fbb.finish().as_union_value();
                offset = BatchComponentProto::create(
                    fbb,
                    &BatchComponentProtoArgs {
                        op_id: op_id,
                        action_type: ActionProto::BatchResponseProto,
                        action: Some(union_offset),
                    },
                );
            }
        }
        return offset;
    }
}
