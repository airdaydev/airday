use crate::sync::proto_generated::proto::{AirdayActionProto, AirdayMessageProto};

pub fn message_handler(message: AirdayMessageProto) {
    for batch_component in message.batch().unwrap() {
        match batch_component.action_type() {
            AirdayActionProto::AuthenticateAction => {
                println!("Received authenticate action");
            }
            AirdayActionProto::AddItemActionProto => {
                println!("Received add item message");
            }
            AirdayActionProto::DeleteItemActionProto => {
                println!("Received delete item message");
            }
            _ => println!("Discarding action"),
        }
    }
}
