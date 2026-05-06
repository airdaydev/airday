# Roadmap

- list deleting - orphan handling?
- list deleting - binned first?

## Correctness

- Snapshot orchestration can get stuck waiting forever.
- Snapshot upload can leak unpushed local state into the shared bootstrap path.
- Revoking a device should probably also disconnect that device's live WebSocket session.

## Sync & persistence

- Server-side compaction after durable snapshots still needs to land.
- Report catch-up volume in `HelloAck` so clients can show progress and we can observe snapshot-vs-tail sync weight.
- Browser reconnect is still fixed-delay. Add real backoff plus online/offline and visibility hooks per platform.
- `status.pending_changes` is currently bool-like; exact pending-op counting can come later by walking the Loro VV diff.
- OPFS has a torn-write hazard: `createWritable -> write -> close` is non-atomic. Likely fix is an incremental update log plus periodic checkpoint.

## Web app

- Multi-tab single-engine sharing via SharedWorker to avoid duplication of resources, data.
- Touch / mobile drag-and-drop support; current primavera DnD is desktop-first.
- Browser automation harness. Manual smoke is still doing the job, but Playwright becomes worthwhile once the UI stops moving around.

## Native clients

- UniFFI bridge for iOS / Android over the existing `core` crate.
- Password-derivation flow exposed over the same bindings.

## Testing

- E2E gaps vs. `spec/testing.md`: offline-mutate-then-sync, both-offline-then-converge, snapshot-threshold to fresh-device bootstrap, and recovery-flow round-trip.
- hardening pass
