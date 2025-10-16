use crate::sync::proto_generated::proto::{ResponseProto, ResponseProtoArgs, UuidProto};
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
    ) -> WIPOffset<ResponseProto<'a>> {
        let offset;
        match self {
            BatchResponse::Applied { op_id, seq } => {
                offset = ResponseProto::create(
                    fbb,
                    &ResponseProtoArgs {
                        op_id: Some(&UuidProto::new(op_id.as_bytes())),
                        success: true,
                        error: None,
                        seq: *seq,
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
                offset = ResponseProto::create(
                    fbb,
                    &ResponseProtoArgs {
                        op_id,
                        success: true,
                        error: Some(err_message),
                        seq: 0,
                    },
                );
            }
        }
        return offset;
    }
}
