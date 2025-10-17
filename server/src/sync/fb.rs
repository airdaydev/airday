use flatbuffers::{FlatBufferBuilder, UnionWIPOffset, WIPOffset};
use uuid::Uuid;

use crate::{
    sync::{
        batch_response::BatchResponse,
        engine::SyncOpSql,
        proto_generated::proto::{
            AuthenticateResponseProto, AuthenticateResponseProtoArgs, BatchResponseProto,
            BatchResponseProtoArgs, BatchSyncOpProto, BatchSyncOpProtoArgs, ErrorResponseProto,
            ErrorResponseProtoArgs, MessageProto, MessageWrapperProto, MessageWrapperProtoArgs,
            ResponseProto, StreamContextProto, StreamEventProto, SyncOpProto, SyncOpProtoArgs,
            UuidProto,
        },
    },
    user::model::User,
};

// TODO: Needs updating to new code
// pub async fn send_shared_libraries<'a>(
//     state: &AppState,
//     fbb: &mut FlatBufferBuilder<'a>,
//     user_id: &Uuid,
// ) -> Result<WIPOffset<BatchComponentProto<'a>>, AppError> {
//     let res = state.db.user.get_by_id(user_id).await?;
//     if let Some(user) = res {
//         if let Some(primary_library) = user.primary_library {
//             let library_id_offset = fbb.create_vector(primary_library.id.as_bytes());
//             let library_name_offset = fbb.create_string(&primary_library.name);
//             let library_args = LibraryProtoArgs {
//                 id: Some(library_id_offset),
//                 name: Some(library_name_offset),
//             };
//             let library_offset = LibraryProto::create(fbb, &library_args);
//             let primary_library_offset = LibrarySyncResponseProtoArgs {
//                 primary_library: Some(library_offset),
//             };
//             let action_offset =
//                 LibrarySyncResponseProto::create(fbb, &primary_library_offset).as_union_value();
//             let batch_offset = BatchComponentProto::create(
//                 fbb,
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

// Useful for acking upstream reqs
pub fn build_batch_response_msg<'a>(
    fbb: &mut FlatBufferBuilder<'a>,
    responses: Vec<BatchResponse>,
) -> WIPOffset<UnionWIPOffset> {
    let mut comps: Vec<WIPOffset<ResponseProto>> = Vec::with_capacity(responses.len());
    for action in responses {
        comps.push(action.build_flatbuffer(fbb));
    }

    let batch_vector = fbb.create_vector(&comps);

    let batch_offset = BatchResponseProto::create(
        fbb,
        &BatchResponseProtoArgs {
            batch: Some(batch_vector),
        },
    )
    .as_union_value();
    batch_offset
}

// Useful for catch up sync
pub fn build_batch_sync_op_msg<'a>(
    fbb: &mut FlatBufferBuilder<'a>,
    responses: Vec<SyncOpSql>,
) -> WIPOffset<UnionWIPOffset> {
    let mut comps: Vec<WIPOffset<SyncOpProto>> = Vec::with_capacity(responses.len());
    for op in responses {
        // TODO: Build the op
        let offset = SyncOpProto::create(
            fbb,
            &SyncOpProtoArgs {
                proto_version: 0,
                base_seq: None, // TODO: May need snapshot bool
                op_id: None,    // TODO: No ID?
                op_kind: op.op_kind,
                library_id: None,
                obj_id: None,
                obj_kind: op.obj_kind,
                path: 0,
                payload: 0,
            },
        );
        comps.push(offset);
    }
    let batch_vector = fbb.create_vector(&comps);
    let batch_offset = BatchSyncOpProto::create(
        fbb,
        &BatchSyncOpProtoArgs {
            stream_context: None, // TODO: Include stream context
            batch: Some(batch_vector),
        },
    )
    .as_union_value();
    batch_offset
}

#[derive(Debug)]
pub struct StreamContext {
    id: Uuid,
    event: StreamEventProto,
}

pub fn create_error_response<'a>(
    fbb: &mut FlatBufferBuilder<'a>,
    message_id: Option<&Uuid>,
    error: &str,
    stream_context: Option<StreamContext>,
) -> WIPOffset<UnionWIPOffset> {
    let uuid;
    let message_id = if let Some(id) = message_id {
        uuid = UuidProto::new(id.as_bytes());
        Some(&uuid)
    } else {
        None
    };
    let error_offset = fbb.create_string(error);
    let stream_context_proto = match stream_context {
        Some(ctx) => Some(&StreamContextProto::new(
            &UuidProto::new(ctx.id.as_bytes()),
            ctx.event,
        )),
        None => None,
    };
    let message_offset = ErrorResponseProto::create(
        fbb,
        &ErrorResponseProtoArgs {
            stream_context: stream_context_proto,
            message_id: message_id,
            error: Some(error_offset),
        },
    );
    message_offset.as_union_value()
}

pub fn build_error_response_message<'a>(
    error: &str,
    message_id: Option<&Uuid>,
    stream_context: Option<StreamContext>,
) -> Vec<u8> {
    let mut fbb = FlatBufferBuilder::new();
    let offset = create_error_response(&mut fbb, message_id, error, stream_context);
    wrap_message(&mut fbb, MessageProto::ErrorResponseProto, offset)
}

pub fn create_auth_response<'a>(
    fbb: &mut FlatBufferBuilder<'a>,
    user: &User,
) -> WIPOffset<UnionWIPOffset> {
    let primary_library = user.primary_library.as_ref().unwrap();
    let action_offset = AuthenticateResponseProto::create(
        fbb,
        &AuthenticateResponseProtoArgs {
            user_id: Some(&UuidProto::new(user.id.as_bytes())),
            library_id: Some(&UuidProto::new(primary_library.id.as_bytes())),
        },
    )
    .as_union_value();
    action_offset
}

pub fn wrap_message<'a>(
    fbb: &mut FlatBufferBuilder<'a>,
    message_type: MessageProto,
    message_offset: WIPOffset<UnionWIPOffset>,
) -> Vec<u8> {
    let message_offset = MessageWrapperProto::create(
        fbb,
        &MessageWrapperProtoArgs {
            message_type,
            message: Some(message_offset),
            ..Default::default()
        },
    );

    fbb.finish(message_offset, None);
    fbb.finished_data().to_vec()
}
