# Roadmap
- Bug 1: snapshot orchestration can get stuck waiting forever.
- Bug 2: snapshots can leak unpushed local state into the shared bootstrap path.
- we should probably disconnect the relevant ws connection when we revoke a device.
**E2E coverage gaps from `spec/testing.md`** — offline-mutate-then-sync, both-offline-then-converge, snapshot-threshold→fresh-device bootstrap, recovery-flow round-trip.
- **Web reconnect backoff** (currently fixed-delay) and
Pending work scooped from `plans/wasm-plan.md`, `plans/sync-engine.md`,
and `plans/sync-engine-slice-4.md`. Source docs keep the rationale;
this is the index.
## Sync engine
- Server reports incoming catchup volume (snapshot bytes + tail-op count/bytes since
  snapshot) in HelloAck, so clients can show progress and we have observability into how
  heavy a sync is.
- Snapshot bootstrap and orchestration are implemented: below-floor clients bootstrap via SnapshotRequired/PullSnapshot, and the server requests fresh snapshots once the op tail exceeds the threshold. Remaining work is server-side compaction after durable snapshots.
- **Reconnect policy.** Browser is fixed-delay retry only; CLI has a
  2s connect timeout + offline fallback. Need real backoff +
  online/offline detection + visibility-event hooks. Per-platform.
- **`status.pending_changes` count.** Currently a bool. Walking Loro
  VV diff for an exact count is sprint-2 polish.

## Storage & persistence

- **OPFS torn-write hazard.** `createWritable → write → close` is
  non-atomic; a tab crash mid-write can lose the only good copy.
  Mitigation: incremental update log + periodic checkpoint
  (`exportFrom(version)` per flush, fresh shallow snapshot every N
  updates / M bytes, truncate log). Same shape the wire protocol
  already uses.

## Web app

- **Multi-tab single-engine sharing.** Avoids duplicate WS sessions
  per account on one origin. Needs BroadcastChannel plumbing; not
  worth it yet.
- **Touch / mobile DnD.** primavera-dnd is desktop-only currently.
- **Playwright / browser test harness.** Manual smoke today; not
  worth the harness setup until UI surface stabilises.

## Native clients
- **UniFFI bridge for iOS/Android.** Same `core` crate, generated
  Swift + Kotlin bindings. `ItemView` / `ListView` / `SyncEngine`
  cross the FFI as canonical types. Spin up when those slices start.
- **Password-derivation flow over UniFFI.** Same bindings as the
  engine.

## Testing
- E2E matrix gaps vs. spec/testing.md. Current CLI E2E only covers reopen persistence and a basic second-device pull; broadcast, snapshot bootstrap seam, and recovery are covered below E2E in server/auth integration. Still missing true E2E: offline-mutate- then-sync, both-offline-then-converge, snapshot-threshold -> fresh-device bootstrap, and recovery-flow round-trip.
