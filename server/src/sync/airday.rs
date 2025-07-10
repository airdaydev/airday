use axum::extract::ws::Message;
use uuid::Uuid;

use crate::{
    AppState,
    common::error::AppError,
    sync::{
        proto_generated::proto::{AirdayActionProto, AirdayMessageProto},
        websocket::send_to_client,
    },
};

pub struct AirdayMessage {
    // TODO: We should match the id 100%, interior actions just need a tick
    pub actions: Vec<AirdayAction>,
}

pub enum AirdayAction {
    Authenticate { session_token: String },
    AddItem { id: String }, // TODO: possible properties not this
    DeleteItem { id: String },
}

impl AirdayMessage {
    pub fn from_proto(message: &AirdayMessageProto) -> Result<Self, AppError> {
        let mut actions = Vec::new();
        let batch = message
            .batch()
            .ok_or(AppError::ValidationError(String::from(
                "No actions found in mesage",
            )))?;
        if batch.len() == 0 {
            return Err(AppError::ValidationError(String::from(
                "No actions found in message",
            )));
        }
        // 0 actions = we should drop this and warn / print
        for batch_component in message.batch().unwrap() {
            println!("the type of the bc is {:?}", batch_component.action_type());
            match batch_component.action_type() {
                AirdayActionProto::AuthenticateActionProto => {
                    println!("Received authentication request");
                    let action = batch_component
                        .action_as_authenticate_action_proto()
                        .ok_or(AppError::ValidationError(String::from(
                            "Could not parse authenticate action",
                        )))?;
                    let token =
                        action
                            .session_token()
                            .ok_or(AppError::ValidationError(String::from(
                                "Authenticat action is missing session_token",
                            )))?;
                    actions.push(AirdayAction::Authenticate {
                        session_token: String::from(token),
                    })
                }
                AirdayActionProto::AddItemActionProto => {
                    let action = batch_component.action_as_add_item_action_proto().ok_or(
                        AppError::ValidationError(String::from("Could not parse add item action")),
                    );
                    println!("Received add item message");
                }
                AirdayActionProto::DeleteItemActionProto => {
                    let action = batch_component
                        .action_as_delete_item_action_proto()
                        .unwrap();
                    println!("Received delete item message");
                }
                _ => {
                    println!("BROKEN");
                    return Err(AppError::ValidationError(String::from(
                        "Unknown message type",
                    )));
                }
            }
        }
        Ok(Self { actions })
    }
}

// TODO: We should probably parse/collect these first then action them
// TODO: All unwraps should be parsing/validation errors
pub async fn message_handler(state: &AppState, message: &AirdayMessage, socket_id: &Uuid) -> () {
    for action in &message.actions {
        match action {
            AirdayAction::Authenticate { session_token } => {
                state.db.session.get_by_token(&session_token).await.unwrap();
                // TODO: Reciprocal Authenticated action (todo: look up that!)
                send_to_client(
                    &state,
                    &socket_id,
                    Message::Text(String::from("test").into()),
                )
                .await;
                return ();
            }
            _ => {
                return ();
            }
        }
    }
}
