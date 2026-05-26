# Shared Worker

Post-launch feature. Do not build this before launch.

## Goal

Run one browser-local runtime per origin/account:

- one doc/runtime
- one websocket
- one WAL writer
- one snapshot writer
- N attached tabs as mirrors

This removes cross-tab duplication and coordination hazards around:

- remote WAL appends
- `lastAckedBlobId` persistence
- websocket ownership
- OPFS snapshot writes

## Current launch stance

Launch with a single-tab assumption.

- Multi-tab is unsupported for now.
- The app should detect a second tab and refuse to run normally there.
- Keep the OPFS single-writer lock design for snapshot commits.

## Required properties later

- stable attach / re-attach protocol per tab
- runtime generation id so stale tabs are rejected
- heartbeats / lease expiry; do not rely on unload for correctness
- full-state attach first, incremental fanout second
- worker owns sync, WAL, snapshot, and device persistence
- tabs send intents and mirror projected state only

## Non-goals for launch

- leader election
- follower runtimes
- cross-tab WAL coordination
- multi-tab sync correctness

## Suggested implementation order later

1. SharedWorker attach/bootstrap protocol
2. page-side client
3. worker-owned sync/socket
4. worker-owned WAL + snapshot + device persistence
5. intent/mirror state flow
6. multi-tab integration tests
