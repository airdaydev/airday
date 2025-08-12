// TODO: Create airday message
use flatbuffers::{FlatBufferBuilder, WIPOffset};
use uuid::Uuid;

use crate::{
    common::error::AppError,
    sync::proto_generated::proto::{
        AckResponseProto, AckResponseProtoArgs, ActionProto, BatchComponentProto,
        BatchComponentProtoArgs, MessageWrapperProto, UuidProto,
    },
};

pub async fn authentication_response<'a>(builder: &mut FlatBufferBuilder<'a>) {
    if let Some(user) = state.db.user.get_by_id(&sesh.user_id).await? {
        let action_offset = AuthenticateResponseProto::create(
            &mut builder,
            &AuthenticateResponseProtoArgs {
                user_id: Some(&UuidProto::new(sesh.user_id.as_bytes())),
                library_id: Some(&UuidProto::new(user.primary_library.unwrap().id.as_bytes())),
            },
        )
        .as_union_value();
        let offset = AirdayBatchComponentProto::create(
            &mut builder,
            &AirdayBatchComponentProtoArgs {
                action_type: AirdayActionProto::AuthenticateResponseProto,
                action: Some(action_offset),
                action_id: None,
            },
        );
    }
}

pub async fn ack<'a>(
    builder: &mut FlatBufferBuilder<'a>,
    message_id: &Uuid,
) -> Result<WIPOffset<BatchComponentProto<'a>>, AppError> {
    let message_id = UuidProto::new(message_id.as_bytes());
    let ack_args = AckResponseProtoArgs {
        message_id: Some(&message_id),
        success: true,
    };
    let action_offset = AckResponseProto::create(builder, &ack_args).as_union_value();
    let batch_offset = BatchComponentProto::create(
        builder,
        &BatchComponentProtoArgs {
            action_type: ActionProto::AckResponseProto,
            action: Some(action_offset),
            action_id: Some(&message_id),
        },
    );
    return Ok(batch_offset);
}

// TODO: Needs updating to new code
// pub async fn send_shared_libraries<'a>(
//     state: &AppState,
//     builder: &mut FlatBufferBuilder<'a>,
//     user_id: &Uuid,
// ) -> Result<WIPOffset<BatchComponentProto<'a>>, AppError> {
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
//             let batch_offset = BatchComponentProto::create(
//                 builder,
//                 &BatchComponentProtoArgs {
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
    action_offsets: Vec<WIPOffset<BatchComponentProto<'a>>>,
) -> Vec<u8> {
    // 1. Build AirdayMessageProto (contains batches)
    let batch = builder.create_vector(&action_offsets);
    let message_offset = MessageWrapperProto::create(
        builder,
        &AirdayMessageProtoArgs {
            batch: Some(batch),
            ..Default::default()
        },
    );

    builder.finish(message_offset, None);
    builder.finished_data().to_vec()
}
