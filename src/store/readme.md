# Notes on item lifecycle in local-first app, conflict resolution, etc

## Time to go deep, start with
- [*] Read [CRDTs are the Future](https://josephg.com/blog/crdts-are-the-future/)
- [*] [CRDTs for Mortals](https://www.youtube.com/watch?v=iEFcmfmdh2w&t=607s)
- [*] Watch [CRDTs: The Hard Parts](https://www.youtube.com/watch?v=x7drE24geUw)
- [] Read [Automerge Quickstart](https://automerge.org/docs/quickstart/)
- [] Read [How Automerge Works](https://automerge.org/docs/how-it-works/backend/)
- [] Read Automerge Binary format https://automerge.org/automerge-binary-format-spec/
- [] https://github.com/alangibson/awesome-crdt
- [] Read Lattice https://en.wikipedia.org/wiki/Lattice_(order)
- [] http://boole.stanford.edu/cs353/handouts/book1.pdf
- [] https://mathworld.wolfram.com/Lattice.html
- https://crdt.tech/
- Vector Clock
- Hybrid Logical Clock

## Item lifecycle(s)

How bad can storage storage pressure get!?
Files should go to file storage and be online first (or set user limit)

#### Completing an item
1. Create new item
2. Click complete
3. op1: save in same storage in same list but marked as completed (Another index would be needed to differentiate both)
3. op2: save in same storage but in counterpast list labelled "done_*" (no specific need for a sort key, redundant information, complete time required - looking like different schema)
3. op3: save in "log" store <- yeah

#### 2 people complete the same item
- What is the end state you want to achive? Either 1. Both log completed version - fine but there should still only be one end item - because items can pick up a bit of metadata, maybe there are docs, images etc in the future - not really a good reason to clone that. Or more simply, you just have a finished or not state - and maybe a DUMB activity log per item i.e. text only (Who did what - i.e. what if two or three people completed it offline)
- 

- Back-end only needs to index by date last changed, clients just sync via last update date

#### Recurring item
1. Create new recurring item
2. Click log
3. op1 (above): we would clone these which is weird
3. op2: still have to clone
4. op3: log item would always generate a new id. sooo no explicit link between original item & new item (except mayyybe some telemetry?).
if two people clicked complete on the same item, what should happen in op3?

#### Putting back an item

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

## Web workers
- Use for initial loading, converging, anything else?


https://www.inkandswitch.com/peritext/
https://www.inkandswitch.com/potluck/demo/?openDocument=welcome