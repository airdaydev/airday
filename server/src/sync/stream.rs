// Streams: Streams resources from a library to a websocket connection until completion
// kill connection on error

use flatbuffers::FlatBufferBuilder;
use std::sync::{Arc, LazyLock};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    AppState,
    common::error::AppError,
    sync::{
        common_generated::common_proto::UuidProto,
        fb::{build_batch_sync_op_msg, wrap_message},
        sync_generated::sync_proto::{MessageProto, StreamContextProto, StreamEventProto},
        websocket::send_to_client,
    },
};

/// Per-process limit on concurrent read chunks across all users.
static GLOBAL_READ_SEM: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(32)));

/// Cap per-user concurrent catch-up streams.
pub const PER_USER_STREAM_LIMIT: usize = 5;

pub struct StreamRequest {
    pub socket_id: Uuid,
    pub stream_id: Uuid,
    pub user_id: Uuid,
    pub library_id: Uuid,
    pub from_seq: i64,
}

const STREAM_BATCH_LEN: usize = 1000;

pub async fn start_catchup_stream(
    app_state: AppState,
    cancel: CancellationToken,
    req: StreamRequest,
) -> Result<(), AppError> {
    // TODO: Stream context? (TODO: Could build it in streamrequest?)
    // let conn = match app_state.ws.get_conn(&req.socket_id) {
    //     None => {
    //         return Err(AppError::ServerError(String::from("Connection not found")));
    //     }
    //     Some(conn) => conn,
    // };
    let head = app_state
        .db
        .sync_op
        .get_stream_head(&req.library_id)
        .await?;
    let mut cur = req.from_seq;
    while cur <= head {
        if cancel.is_cancelled() {
            // TODO: Send cancelled stream msg
            // send_to_client(&app_state.ws, &req.socket_id, message);
            break;
        }
        let range = app_state
            .db
            .sync_op
            .seq_range(&req.library_id, cur, head, STREAM_BATCH_LEN as i64)
            .await?;
        let mut stream_event = StreamEventProto::Data;
        let last_batch = range.len() < STREAM_BATCH_LEN;
        if last_batch {
            stream_event = StreamEventProto::End;
        }
        let mut fbb = FlatBufferBuilder::new();
        let stream_context = Some(&StreamContextProto::new(
            &UuidProto::new(req.stream_id.as_bytes()),
            stream_event,
        ));
        let message_offset = build_batch_sync_op_msg(&mut fbb, &range, stream_context);
        let message = wrap_message(&mut fbb, MessageProto::BatchSyncOpProto, message_offset);
        send_to_client(&app_state.ws, &req.socket_id, message).await;
        if last_batch {
            break;
        } else {
            cur = range[range.len() - 1].seq;
        }
    }
    Ok(())
}
