# Notes on item lifecycle etc

## data pipeline
server (online persistence) -> ws (comms) -> idb (offline persistence) -> fast list (fast, optimistic access) -> display list (rendering & interaction)

## Lists
- Store in indexeddb in lists "table"

## Config
- Local store synced, but device preference may override depending on preference (maybe just desktop vs mobile)?

## UI
1. Send state trigger scoped signal to list per update (Consider sending item scoped update too)
2. Computer range of items visible in list +10 outside (use id as tracking key) on signal

## Selection
1. Maintain selection state (set) per open list (thus last list state must be tracked - transient per session)

## Networking
1. Create item locally by inserting into indexdb, ensuring no key conflicts
2. Use item.syncStatus = 1 | 2 | 3 | 4, noSync, syncing, synced, error, retries
3. syncing = set of items currently syncing
4. sync via ws, max 5 at time, flushing immediately, sending batched updates (i.e. moving multiple objects) where they occur, remove from sync state when done, updated to synced
5. record problematic syncs in app

- inform user when sync is connected
- provide basic sync stats (how many items to sync, last sync, how many syncing, local sync errors, etc)

## Server
- Full CRDT approach could work
- Good nosql fit (at most complicated single user + list + item + list/board collaborators + shares)

## Sorting
- fractional-indexing
- Use id as a tie-breaker
- 

## Web workers
- Use for initial loading, converging, anything else?
