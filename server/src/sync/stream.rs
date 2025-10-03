// Streams: Streams resources from a library to a websocket connection until completion
// kill connection on error

use std::sync::{Arc, LazyLock};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{AppState, common::error::AppError, sync::websocket::send_to_client};

/// Per-process limit on concurrent read chunks across all users.
static GLOBAL_READ_SEM: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(32)));

/// Cap per-user concurrent catch-up streams.
pub const PER_USER_STREAM_LIMIT: usize = 5;

pub struct StreamRequest {
    pub socket_id: Uuid,
    pub user_id: Uuid,
    pub library_id: Uuid,
    pub from_seq: i64,
}

pub async fn start_catchup_stream(
    app_state: AppState,
    cancel: CancellationToken,
    req: StreamRequest,
) -> Result<(), AppError> {
    let conn = match app_state.ws.get_conn(&req.socket_id) {
        None => {
            return Err(AppError::ServerError(String::from("Connection not found")));
        }
        Some(conn) => conn,
    };
    let head = app_state
        .db
        .sync_op
        .get_stream_head(&req.library_id)
        .await?;
    let cur = 0;
    while cur <= head {
        if (cancel.is_cancelled()) {
            // TODO: Send cancelled stream msg
            // send_to_client(&app_state.ws, &req.socket_id, message);
            break;
        }
        let range = app_state
            .db
            .sync_op
            .seq_range(&req.library_id, req.from_seq, head, 50)
            .await?;
        // TODO: Serialise and send to client
        // send_to_client(&app_state.ws, &req.socket_id, message);
    }
    Ok(())
}
