use crate::{
    AppState,
    common::error::AppError,
    sync::proto_generated::proto::{AirdayActionProto, AirdayMessageProto},
};

pub struct AirdayMessage {
    // TODO: We should match the id 100%, interior actions just need a tick
    actions: Vec<AirdayAction>,
}

pub enum AirdayAction {
    Authenticate { session_token: String },
    AddItem { item_data: String },
    // DeleteItem { id: String },
}

impl AirdayMessage {
    pub fn from_proto(message: &AirdayMessageProto) -> Result<Self, AppError> {
        let mut actions = Vec::new();
        for batch_component in message.batch().unwrap() {
            match batch_component.action_type() {
                AirdayActionProto::AuthenticateAction => {
                    let action = batch_component.action_as_authenticate_action().ok_or(
                        AppError::ValidationError(String::from(
                            "Could not parse authenticate action",
                        )),
                    )?;
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
pub async fn message_handler(state: &AppState, message: &AirdayMessage) -> () {
    for action in &message.actions {
        match action {
            AirdayAction::Authenticate { session_token } => {
                state.db.session.get_by_token(&session_token).await.unwrap();
                return ();
            }
            _ => {
                return ();
            }
        }
    }
}
