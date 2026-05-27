# Roadmap
- list deleting - orphan handling?
- list deleting - binned first?
- import/export

## Sync & persistence
- Report catch-up volume in `HelloAck` so clients can show progress and we can observe snapshot-vs-tail sync weight.
- `status.pending_changes` is currently bool-like; exact pending-op counting can come later by walking the Loro VV diff.
- OPFS has a torn-write hazard: `createWritable -> write -> close` is non-atomic. Likely fix is an incremental update log plus periodic checkpoint.

## Compaction [CONSIDER LEAVING THIS TIL POST-RELEASE]
One latent thing remains, but it was already scoped out in your handoff:
  core/src/doc.rs::snapshot_blob still calls ExportMode::Snapshot (full), so the
  snapshot payload doesn't trim Loro's internal history even though the ops table does.
  That means bootstrap downloads are bigger than they need to be, but the ops-table
  storage win is fully realized. Switching to ExportMode::shallow_snapshot(frontier) means VV tracking.

GC is done on client with VV knowledge accumulated from devices directly. blobs are GC'd separately via op_seq_id, we know the latest contiguous op_seq_id within the client-generated snapshot, the snapshot having some additional extra local information is fine VV is for computing horizon and gc at snapshot time (deleting useless past) op_seq_id is for computing server blob GC (deleting redundancies on server)


## Web app
- Multi-tab single-engine sharing via SharedWorker to avoid duplication of resources, data.
- Touch / mobile drag-and-drop support; current primavera DnD is desktop-first.
- Browser automation harness. Manual smoke is still doing the job, but Playwright becomes worthwhile as a sanity check.

## Native clients
- UniFFI bridge for iOS / Android over the existing `core` crate.
- Password-derivation flow exposed over the same bindings.

## Testing
- E2E gaps vs. `spec/testing.md`: offline-mutate-then-sync, both-offline-then-converge, snapshot-threshold to fresh-device bootstrap, and recovery-flow round-trip.
- hardening pass

## Postgresql version
- ensure single snapshot per account across replicas
- ensure deletion/cleanup doesn't run too often and under contention across replicas?!
- migration strategy

## CI
- sqlite migrations

## CLI
- Sqlite storage

## Bug
- When we click done, then edit the item, waiting for it to depart that list, it goes bad.

## Maybe
- Encoding habits?
- vi keys (as an option)
