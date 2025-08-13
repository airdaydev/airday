use crate::{
    AppState,
    common::utils::proto_uuid_to_uuid,
    item::model::Item,
    sync::proto_generated::proto::{ActionProto, BatchSyncProto, BatchSyncProtoArgs},
};
use flatbuffers::{FlatBufferBuilder, UnionWIPOffset, WIPOffset};
use uuid::Uuid;

// TODO: Reconsider need for intermediate object
pub enum BatchAction {
    SyncItem { item: Item, action_id: Uuid },
    Ack { item: Item, action_id: Uuid },
    Error { message: String },
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
    // let mut trx; // TODO: Ensure drop!!!
    for batch_component in &message.batch() {
        match batch_component.action_type() {
            ActionProto::SyncItemActionProto => {
                let Some(action) = batch_component.action_as_sync_item_action_proto() else {
                    // Error!
                    responses.push(BatchAction::Error {
                        message: String::from("invalid message"),
                    });
                    continue;
                };
                let library_id = proto_uuid_to_uuid(action.item().library_id());
                if state.auth_cache.check(state, &user_id, &library_id).await == false {
                    responses.push(BatchAction::Error {
                        message: String::from("permission error"),
                    });
                    continue;
                }
                // TODO: Construct item
                let item = Item::from_item_proto(&action.item());
                let _ = state.db.item.merge(&item).await;
                responses.push(BatchAction::Ack {
                    item,
                    action_id: proto_uuid_to_uuid(batch_component.action_id()),
                });
            }
            _ => {
                // Generate error
            }
        }
    }
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
