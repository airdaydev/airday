// Streams: Streams resources from a library to a websocket connection until completion
// kill connection on error

// TODO: Upper bounds on stream creation = 64
pub fn create_stream() {}

// AirdayAction::StreamReq {
//     library_id,
//     resource,
//     timestamp,
// } => {
fn idk() {
    if !has_library_access(state, conn.user_id, *library_id).await {
        return Ok(());
    }
    // loop through requested resources and send until end
    match *resource {
        ResourceType::Item => {
            // get items affected since timestamp - 1minute
            let stream = state.db.item.get_by_library_stream(library_id, *timestamp);
            let mut chunked_stream = stream.chunks(50);
            // TODO: Chunk and send, batches of 50-100?
            while let Some(value) = chunked_stream.next().await {
                // println!("hello! {:?}", value);
            }
        }
        ResourceType::List => {
            // get lists affected since timestamp - 1minute
        }
        _ => {}
    }
    // send_to_client(state, socket_id, message).await;
    // on end (OR ERROR), send a end message to close the stream
    // TODO: Ensure this attempts in an own thread (i forget context)
}
