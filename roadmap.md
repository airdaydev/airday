# Roadmap
- list deleting - orphan handling?
- list deleting - binned first?
- import/export

## Sync & persistence
- Report catch-up volume in `HelloAck` so clients can show progress and we can observe snapshot-vs-tail sync weight.
- `status.pending_changes` is currently bool-like; exact pending-op counting can come later by walking the Loro VV diff.
- OPFS has a torn-write hazard: `createWritable -> write -> close` is non-atomic. Likely fix is an incremental update log plus periodic checkpoint.

## Compaction
One latent thing remains, but it was already scoped out in your handoff:
  core/src/doc.rs::snapshot_blob still calls ExportMode::Snapshot (full), so the
  snapshot payload doesn't trim Loro's internal history even though the ops table does.
  That means bootstrap downloads are bigger than they need to be, but the ops-table
  storage win is fully realized. Switching to ExportMode::shallow_snapshot(frontier)
  needs the op_id → Loro frontier mapping that doesn't exist client-side yet — separate
  task whenever you want to chase it.

Implement a client-side sync index that records the cumulative Loro VersionVector or
  frontiers for each contiguous server op_id prefix as blobs are applied or acknowledged,
  persist that index alongside local state, seed it correctly when bootstrapping from a
  server snapshot by also carrying the snapshot’s shallow_start_op_id, and then change
  snapshot production so SnapshotRequest.shallow_start_op_id is translated through that
  index into the corresponding Loro frontier and exported with
  ExportMode::shallow_snapshot(...) instead of ExportMode::Snapshot; the server logic can
  stay essentially the same apart from including the snapshot floor metadata on bootstrap
  responses.


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
