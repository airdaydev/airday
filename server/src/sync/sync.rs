use crate::{
    AppState,
    common::utils::proto_uuid_to_uuid,
    item::model::Item,
    sync::proto_generated::proto::{
        ActionProto, BatchComponentProto, BatchComponentProtoArgs, BatchResponseProto,
        BatchResponseProtoArgs, BatchResponseProtoBuilder, BatchSyncProto, UuidProto,
    },
};
use flatbuffers::{FlatBufferBuilder, WIPOffset};
use uuid::Uuid;

pub enum BatchAction {
    Applied {
        action_id: Uuid,
        server_timestamp: i64,
    },
    Error {
        action_id: Option<Uuid>,
        message: String,
    },
}

impl BatchAction {
    pub fn build_flatbuffer<'a>(
        &self,
        fbb: &mut FlatBufferBuilder<'a>,
    ) -> WIPOffset<BatchComponentProto<'a>> {
        let offset;
        match self {
            BatchAction::Applied {
                action_id,
                server_timestamp,
            } => {
                let id_proto = UuidProto::new(action_id.as_bytes());
                let union_offset = BatchResponseProto::create(
                    fbb,
                    &BatchResponseProtoArgs {
                        success: true,
                        error: None,
                        server_timestamp: *server_timestamp,
                    },
                )
                .as_union_value();
                offset = BatchComponentProto::create(
                    fbb,
                    &BatchComponentProtoArgs {
                        action_id: Some(&id_proto),
                        action_type: ActionProto::BatchResponseProto,
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
                let mut err_fbb = BatchResponseProtoBuilder::new(fbb);
                err_fbb.add_success(false);
                err_fbb.add_error(err_message);
                let union_offset = err_fbb.finish().as_union_value();
                offset = BatchComponentProto::create(
                    fbb,
                    &BatchComponentProtoArgs {
                        action_id: action_id,
                        action_type: ActionProto::BatchResponseProto,
                        action: Some(union_offset),
                    },
                );
            }
        }
        return offset;
    }
}

// TODO: Consider maintaining input<->output positional correspondence (Use initially sparse index w options)
pub async fn process_sync_batch<'a>(
    state: &AppState,
    message: &BatchSyncProto<'a>,
    user_id: &Uuid,
) -> Vec<BatchAction> {
    let mut responses: Vec<BatchAction> = Vec::new();
    let mut items: Vec<Item> = Vec::new();
    let mut action_index: Vec<(Uuid, usize)> = Vec::new();
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
                let action_id = proto_uuid_to_uuid(batch_component.action_id());
                let library_id = proto_uuid_to_uuid(action.item().library_id());
                if state.auth_cache.check(state, &user_id, &library_id).await == false {
                    responses.push(BatchAction::Error {
                        action_id: Some(action_id),
                        message: String::from("unauthorised"),
                    });
                    continue;
                }
                let item = Item::from_item_proto(&action.item());
                action_index.push((action_id, items.len()));
                items.push(item);
            }
            _ => {
                responses.push(BatchAction::Error {
                    action_id: None,
                    message: String::from("invalid action_type"),
                });
            }
        }
    }
    let Ok(result) = state.db.item.merge_many(&items).await else {
        for (action_id, _) in action_index {
            responses.push(BatchAction::Error {
                action_id: Some(action_id),
                message: String::from("unauthorised"),
            });
        }
        return responses;
    };
    for (action_id, index) in action_index {
        if let Some(server_timestamp) = result[index] {
            responses.push(BatchAction::Applied {
                action_id: action_id,
                server_timestamp: server_timestamp,
            });
        } else {
            responses.push(BatchAction::Error {
                action_id: Some(action_id),
                message: String::from("merge error"),
            })
        }
    }
    responses
}
