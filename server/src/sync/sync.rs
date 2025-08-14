use crate::{
    AppState,
    common::utils::proto_uuid_to_uuid,
    item::model::Item,
    sync::proto_generated::proto::{
        AckResponseProto, AckResponseProtoArgs, ActionProto, BatchComponentProto,
        BatchComponentProtoArgs, BatchErrorResponseProtoBuilder, BatchSyncProto,
        BatchSyncProtoArgs, UuidProto,
    },
};
use flatbuffers::{FlatBufferBuilder, UnionWIPOffset, WIPOffset};
use uuid::Uuid;

// TODO: Reconsider need for intermediate object
pub enum BatchAction {
    Ack {
        action_id: Uuid,
    },
    Error {
        action_id: Option<Uuid>,
        message: String,
    },
}

impl BatchAction {
    fn build_flatbuffer<'a>(
        &self,
        fbb: &'a mut FlatBufferBuilder,
    ) -> WIPOffset<BatchComponentProto<'a>> {
        let offset;
        match self {
            BatchAction::Ack { action_id } => {
                let id_proto = UuidProto::new(action_id.as_bytes());
                let union_offset =
                    AckResponseProto::create(fbb, &AckResponseProtoArgs {}).as_union_value();
                offset = BatchComponentProto::create(
                    fbb,
                    &BatchComponentProtoArgs {
                        action_id: Some(&id_proto),
                        action_type: ActionProto::AckResponseProto,
                        action: Some(union_offset),
                    },
                );
            }
            BatchAction::Error { action_id, message } => {
                let err_message = fbb.create_string(message);
                let id_proto;
                let action_id = match action_id {
                    Some(action_id) => {
                        id_proto = UuidProto::new(action_id.as_bytes());
                        Some(&id_proto)
                    }
                    None => None,
                };
                let mut err_fbb = BatchErrorResponseProtoBuilder::new(fbb);
                err_fbb.add_message(err_message);
                let union_offset = err_fbb.finish().as_union_value();
                offset = BatchComponentProto::create(
                    fbb,
                    &BatchComponentProtoArgs {
                        action_id: action_id,
                        action_type: ActionProto::BatchErrorResponseProto,
                        action: Some(union_offset),
                    },
                );
            }
        }
        return offset;
    }
}

pub struct BatchSync {
    // TODO: We should match the id 100%, interior actions just need a tick
    pub actions: Vec<BatchAction>,
}

// TODO: Create error resposes for each message
pub async fn process_sync_batch<'a>(
    state: &AppState,
    message: &BatchSyncProto<'a>,
    user_id: &Uuid,
) -> Vec<BatchAction> {
    let mut responses: Vec<BatchAction> = Vec::new();
    let mut items: Vec<Item> = Vec::new();
    for batch_component in &message.batch() {
        match batch_component.action_type() {
            ActionProto::SyncItemActionProto => {
                let Some(action) = batch_component.action_as_sync_item_action_proto() else {
                    responses.push(BatchAction::Error {
                        action_id: None,
                        message: String::from("invalid message"),
                    });
                    continue;
                };
                let library_id = proto_uuid_to_uuid(action.item().library_id());
                if state.auth_cache.check(state, &user_id, &library_id).await == false {
                    responses.push(BatchAction::Error {
                        action_id: Some(proto_uuid_to_uuid(batch_component.action_id())),
                        message: String::from("unauthorised"),
                    });
                    continue;
                }
                let item = Item::from_item_proto(&action.item());
                items.push(item);
                responses.push(BatchAction::Ack {
                    action_id: proto_uuid_to_uuid(batch_component.action_id()),
                });
            }
            _ => {
                // Generate error
            }
        }
    }
    let Ok(result) = state.db.item.merge_many(&items).await else {
        // This should be equivalent to a full rollback
      return responses;
    }
    // run merge operations
    responses
}

pub fn build_batch_sync_msg<'a>(
    builder: &'a mut FlatBufferBuilder,
    _actions: Vec<BatchAction>,
) -> WIPOffset<UnionWIPOffset> {
    let batch_offset = BatchSyncProto::create(
        builder,
        &BatchSyncProtoArgs {
            stream_context: None,
            batch: None,
        },
    )
    .as_union_value();
    batch_offset
}
