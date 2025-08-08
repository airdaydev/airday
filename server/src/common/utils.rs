use uuid::Uuid;

use crate::{common::error::AppError, sync::proto_generated::proto::UuidProto};

/// Legacy flatbuffer variable version (FB doesn't compile static sized vars in some langs e.g. Swift)
pub fn fbv_to_uuid<'a>(id_buffer: flatbuffers::Vector<'a, u8>) -> Result<Uuid, AppError> {
    let id_bytes: [u8; 16] = id_buffer
        .bytes()
        .try_into()
        .map_err(|_| AppError::ValidationError(String::from("Could not validate UUID")))?;
    let zero_id: [u8; 16] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    if id_bytes == zero_id {
        Err(AppError::ValidationError(String::from("All zero uuid")))?;
    }
    Ok(Uuid::from_bytes(id_bytes))
}

pub fn proto_uuid_to_uuid(proto: &UuidProto) -> Uuid {
    let highd: [u8; 16] = proto.0;
    Uuid::from_bytes(highd)
}
