use uuid::Uuid;

use crate::common::error::AppError;

/// flatbuffer vector (variable length) to uuid
/// This is necessary bc there are is no swift output for the fixed length uuid
/// I MAY NOT NEED SWIFT OUTPUT however if i can get away with a rust backed core
/// so i can simplify this later
pub fn fbv_to_uuid<'a>(id_buffer: flatbuffers::Vector<'a, u8>) -> Result<Uuid, AppError> {
    let id_bytes: [u8; 16] = id_buffer
        .bytes()
        .try_into()
        .map_err(|_| AppError::ValidationError(String::from("Could not validate UUID")))?;
    Ok(Uuid::from_bytes(id_bytes))
}
