// TODO: Create airday message
use flatbuffers::{FlatBufferBuilder, WIPOffset};
use uuid::Uuid;

use crate::{
    common::error::AppError,
    sync::proto_generated::proto::{
        AckResponseProto, AckResponseProtoArgs, AirdayActionProto, AirdayBatchComponentProto,
        AirdayBatchComponentProtoArgs, AirdayMessageProto, AirdayMessageProtoArgs,
    },
};

pub async fn ack<'a>(
    builder: &mut FlatBufferBuilder<'a>,
    message_id: &Uuid,
) -> Result<WIPOffset<AirdayBatchComponentProto<'a>>, AppError> {
    let message_id_offset = builder.create_vector(message_id.as_bytes());
    let ack_args = AckResponseProtoArgs {
        message_id: Some(message_id_offset),
        success: true,
    };
    let action_offset = AckResponseProto::create(builder, &ack_args).as_union_value();
    let action_id_offset = builder.create_vector(message_id.as_bytes());
    let batch_offset = AirdayBatchComponentProto::create(
        builder,
        &AirdayBatchComponentProtoArgs {
            action_type: AirdayActionProto::AckResponseProto,
            action: Some(action_offset),
            action_id: Some(action_id_offset),
        },
    );
    return Ok(batch_offset);
}

// TODO: Needs updating to new code
// pub async fn send_shared_libraries<'a>(
//     state: &AppState,
//     builder: &mut FlatBufferBuilder<'a>,
//     user_id: &Uuid,
// ) -> Result<WIPOffset<AirdayBatchComponentProto<'a>>, AppError> {
//     let res = state.db.user.get_by_id(user_id).await?;
//     if let Some(user) = res {
//         if let Some(primary_library) = user.primary_library {
//             let library_id_offset = builder.create_vector(primary_library.id.as_bytes());
//             let library_name_offset = builder.create_string(&primary_library.name);
//             let library_args = LibraryProtoArgs {
//                 id: Some(library_id_offset),
//                 name: Some(library_name_offset),
//             };
//             let library_offset = LibraryProto::create(builder, &library_args);
//             let primary_library_offset = LibrarySyncResponseProtoArgs {
//                 primary_library: Some(library_offset),
//             };
//             let action_offset =
//                 LibrarySyncResponseProto::create(builder, &primary_library_offset).as_union_value();
//             let batch_offset = AirdayBatchComponentProto::create(
//                 builder,
//                 &AirdayBatchComponentProtoArgs {
//                     action_type: AirdayActionProto::LibrarySyncResponseProto,
//                     action: Some(action_offset),
//                 },
//             );
//             return Ok(batch_offset);
//         }
//     }
//     Err(AppError::ServerError(String::from(
//         "Couldn't find primary library",
//     )))
// }

pub fn create_airday_message_with_builder<'a>(
    builder: &mut FlatBufferBuilder<'a>,
    action_offsets: Vec<WIPOffset<AirdayBatchComponentProto<'a>>>,
) -> Vec<u8> {
    // 1. Build AirdayMessageProto (contains batches)
    let batch = builder.create_vector(&action_offsets);
    let message_offset = AirdayMessageProto::create(
        builder,
        &AirdayMessageProtoArgs {
            batch: Some(batch),
            ..Default::default()
        },
    );

    builder.finish(message_offset, None);
    builder.finished_data().to_vec()
}
