use axum::extract::ws::{WebSocket, WebSocketUpgrade};
use axum::response::Response;
use serde::{Deserialize, Serialize};

// auth handler
// channel: sync
// type: create_item
// data: serialised_item

pub async fn handler(ws: WebSocketUpgrade) -> Response {
    // TODO: Unwrap auth here
    ws.on_upgrade(handle_socket)
}

#[derive(Debug, Deserialize, Serialize)]
struct CreateItemMessage {}

async fn handle_socket(mut socket: WebSocket) {
    while let Some(msg) = socket.recv().await {
        let msg = if let Ok(msg) = msg {
            println!("{:?}", msg);
            msg
        } else {
            // client disconnected
            return;
        };

        if socket.send(msg).await.is_err() {
            // client disconnected
            return;
        }
    }
}
