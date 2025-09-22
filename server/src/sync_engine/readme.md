## Airday sync engine

Server storage (low/no knowledge), optionally full history (account flag):
E2EE(op) + SHA_256(E2EE(op))

Client storage (full knowledge of actual state):
Merged item
SHA_256(E2EEE(op))

Sync protocol with JS client / Rust server:

Patches:
1. Client edits field, generating an op
2. Client persists op in outbox + latest item in indexeddb
3. Every tick while <MAX_PENDING pending messages, batch up to MAX_PENDING-pending_count ops
4. Send over flatbuffer with exposed metadata + e2ee(data) to server
5. Save op

Snaphots:
1. Client keeps track of op count per item
2. When free, client creates a snapshot of item & saves in indexeddb & op log, with base_seq = last seen server base_seq
3. snapshot added to same queue and sent to server
4. server receives snapshot event, saves to database and sets archived=true on all matching (library_id,id) with seq =< base_seq

Deletes:
1. Client signals to delete item
2. op "delete" persisted on outbox
3. op gets picked up & sent to server
4. server sends back "delete" messages
5. client can now 100% delete this (worst case - commit failure, the client will just regenerate it during merkle phase)

Sync stream:
1. Client requests data since seq = x
2. server opens up stream to client, recording each seq

Questions:
- TODO: seq per transaction or per change?

Optimisations:
- Specific transactions instead of Optimisations
