use flatbuffers::{FlatBufferBuilder, UnionWIPOffset, WIPOffset};
use uuid::Uuid;

use crate::{
    common::error::AppError,
    sync::proto_generated::proto::{
        AckResponseProto, AckResponseProtoArgs, ActionProto, AuthenticateResponseProto,
        AuthenticateResponseProtoArgs, BatchComponentProto, BatchComponentProtoArgs,
        BatchErrorResponseProto, BatchErrorResponseProtoArgs, BatchSyncProto, BatchSyncProtoArgs,
        ErrorResponseProto, ErrorResponseProtoArgs, MessageProto, MessageWrapperProto,
        MessageWrapperProtoArgs, UuidProto,
    },
    user::model::User,
};

pub async fn ack_batch_response<'a>(
    builder: &mut FlatBufferBuilder<'a>,
    action_id: &Uuid,
) -> Result<WIPOffset<BatchComponentProto<'a>>, AppError> {
    let action_id = UuidProto::new(action_id.as_bytes());
    let action_offset =
        AckResponseProto::create(builder, &AckResponseProtoArgs {}).as_union_value();
    let batch_offset = BatchComponentProto::create(
        builder,
        &BatchComponentProtoArgs {
            action_type: ActionProto::AckResponseProto,
            action: Some(action_offset),
            action_id: Some(&action_id),
        },
    );
    return Ok(batch_offset);
}

pub async fn err_batch_response<'a>(
    builder: &mut FlatBufferBuilder<'a>,
    action_id: &Uuid,
    message: &str,
) -> Result<WIPOffset<BatchComponentProto<'a>>, AppError> {
    let action_id = UuidProto::new(action_id.as_bytes());
    let str = builder.create_string(message);
    let action_offset = BatchErrorResponseProto::create(
        builder,
        &BatchErrorResponseProtoArgs { message: Some(str) },
    )
    .as_union_value();
    let batch_offset = BatchComponentProto::create(
        builder,
        &BatchComponentProtoArgs {
            action_type: ActionProto::AckResponseProto,
            action: Some(action_offset),
            action_id: Some(&action_id),
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

pub fn create_batch_sync_message<'a>(
    builder: &'a mut FlatBufferBuilder<'a>,
    action_offsets: Vec<WIPOffset<BatchComponentProto<'a>>>,
) -> WIPOffset<UnionWIPOffset> {
    let batch = builder.create_vector(&action_offsets);
    let message_offset = BatchSyncProto::create(
        builder,
        &BatchSyncProtoArgs {
            batch: Some(batch),
            ..Default::default()
        },
    );
    message_offset.as_union_value()
}

pub fn create_error_response<'a>(
    builder: &mut FlatBufferBuilder<'a>,
    message_id: Option<&Uuid>,
    error: &str,
) -> WIPOffset<UnionWIPOffset> {
    let uuid;
    let message_id = if let Some(id) = message_id {
        uuid = UuidProto::new(id.as_bytes());
        Some(&uuid)
    } else {
        None
    };
    let error_offset = builder.create_string(error);
    let message_offset = ErrorResponseProto::create(
        builder,
        &ErrorResponseProtoArgs {
            message_id: message_id,
            error: Some(error_offset),
        },
    );
    message_offset.as_union_value()
}

pub fn build_error_response_message<'a>(error: &str, message_id: Option<&Uuid>) -> Vec<u8> {
    let mut builder = FlatBufferBuilder::new();
    let offset = create_error_response(&mut builder, message_id, error);
    wrap_message(&mut builder, MessageProto::ErrorResponseProto, offset)
}

pub fn create_auth_response<'a>(
    builder: &mut FlatBufferBuilder<'a>,
    user: &User,
) -> WIPOffset<UnionWIPOffset> {
    let primary_library = user.primary_library.as_ref().unwrap();
    let action_offset = AuthenticateResponseProto::create(
        builder,
        &AuthenticateResponseProtoArgs {
            user_id: Some(&UuidProto::new(user.id.as_bytes())),
            library_id: Some(&UuidProto::new(primary_library.id.as_bytes())),
        },
    )
    .as_union_value();
    action_offset
}

pub fn wrap_message<'a>(
    builder: &mut FlatBufferBuilder<'a>,
    message_type: MessageProto,
    message_offset: WIPOffset<UnionWIPOffset>,
) -> Vec<u8> {
    // 1. Build MessageProto (contains batches)
    // 2. Wrap in MessageWrapper
    let message_offset = MessageWrapperProto::create(
        builder,
        &MessageWrapperProtoArgs {
            message_type,
            message: Some(message_offset),
            ..Default::default()
        },
    );

    builder.finish(message_offset, None);
    builder.finished_data().to_vec()
}
