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
3. op1: save in same storage in same list but marked as completed (add another index to differentiate/filter) <- the way to go in crdt
4. Client indexes

The key is that the server is dumb as a fucking brick

#### Recurring item
Log formed ON the item itself! Statistics calculated on the item asynchronously, when last update received. (this should be a worker job)
- The disadvantage is that the item will not show up in overall logged items - an artifact could be created. a historical record linked to main item

#### Putting back an item
Undone

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