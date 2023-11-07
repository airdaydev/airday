# Data model

## Persistence pipeline
server (online persistence) -> ws (comms) -> idb (offline persistence) -> fast list (fast, optimistic access) -> display list (rendering & interaction)

Server: public id, public timestamp register, encrypted contents
WS: 2 way encrypted
Assembler: crdt
IDB: fully unencrypted & assembled (?) (Support for in-flight updates)
Fast list: in memory optimistic access
Display list: rendering & interaction

## Pseudocode stream for completing an item - upstream
1. New action { action: completed, date: new Date() }
#### OPTIMISTIC UI Updates:
2. Done list adds completed item
3. regular lists remove item (queries to consider later)
#### Sync/Storage
Transaction:
1. Action applied immediately to crdt & result stored
2. Pending action idb queue

(UNDO/REDO):
Pending actions for session stored in-memory store as counter actions

## downstream:
Update received
1. Action applied immediately to crdt & results stored with vector clock
2. IDB item computed
3. Fast list item updated


## Resource types (with tombstones)
Items
Lists
List_item incl. order (TODO: CRDT approach to ordering?) (listId, itemId, sortKey) - itemId as tie-breaker
Completed_item: Reference to list
Archived_list: Before deletion it sits here

## Retrieving a deleted an item
- Remove list_item association
- Remove item (mark object as deleted: true)

## Scenario: An existing item is deleted by C2, patched again by C1
1. { id: 1, text: 'yah' }
2. { id: 1, delete: true }
3. { id: 1, text: 'no' }

The server can be aware if 'deleted' property is shared by server thus tombstoned. Update rejected. Avoiding a tombstone? If we get a patch, but have no associated item, in a central sync server situation, we can assume this item is dead, because it necessitates a created must have passed through, but is not there, thus deleted.

## Imagining full p2p sync
TODO: do common crdt imagine central server still?

Epoch 1
p1 [a, b, c]
p2 [x, y]
p3 [z]

Epoch 2
p1 [a, b, c] *incomplete
p2 [a, b, c, x^, y] (^ = deleted)
p3 [a, b, c z, x, y]

Epoch 3
p1 [a, b, c, x#, y] (# = patched)
p2 [a, b, c, x^, y]
p3 [a, b, c z, x^, y]

Epoch 4
p1 [a, b, c, x#^, y]
p2 [a, b, c, x^#, y]
p3 [a, b, c z, x^#, y]

Focusing on x
sequence possibilities:

x#^
x^#
#x^
#^x (patched, deleted, created)
^#x (deleted, patched, created)
^x# (deleted, created, patched)
#x (patched, created)
x# (synced, patched)
^# (delete, patch)
#^ (patch, delete)
~~^~~
~~#~~
x (created)

Conjecture: Receiving a patch/delete without predecessor create, is impossible, in an ordered log sync approach. (Tombstones unavoidable?)

## Mitigating tombstone size issues
- Compact tombstones with simple compression
- Use minimal ids (clientId - server to designate client name)

Client A: Create, Patch (not synced with b yet)
Client B: Create, Delete (GONE), (Create, Patch) (Lost sight of delete)
Client C: Create, Delete (GONE)

With a central sync server, using timestamps, we can guarantee that if an item receives a delete/patch op, to an item that doesn't exist, the delete/patch can be discarded w/o need for tombstone.

P2P retains a log of all syncs with that sync server

client_sync_table
{
    last_log: # i.e. last fragment received in order
    client_id: a
}

tombstones are cheap (id) but grow indefinitely

Simpler illustration
Server deletes all record incl. action, so can't pass action to client UNTIL subscribed client updated to that point