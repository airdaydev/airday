# Roadmap

Pending work scooped from `plans/wasm-plan.md`, `plans/sync-engine.md`,
and `plans/sync-engine-slice-4.md`. Source docs keep the rationale;
this is the index.

## Sync engine

- **Snapshot orchestration.** Wire types exist
  (`PushSnapshot`/`PullSnapshot`/`SnapshotRequest`/`Snapshot`); the WS
  handler currently ignores them with a warning. Need: server-side
  threshold check (`latest_op_id − latest_snapshot.up_to_op_id > 10_000`),
  client serialize+seal+upload, server-side compaction job. Required
  before the dataset gets old.
- **Snapshot bootstrap on fresh device.** Currently op-replay only;
  acceptable while accounts are tiny. Pulled forward when freshness
  or device-N onboarding force it.
- **Reconnect policy.** Browser is fixed-delay retry only; CLI has a
  2s connect timeout + offline fallback. Need real backoff +
  online/offline detection + visibility-event hooks. Per-platform.
- **`status.pending_changes` count.** Currently a bool. Walking Loro
  VV diff for an exact count is sprint-2 polish.

## Auth & identity

- **Argon2id in a worker.** Login spinner blocks the main thread for
  ~150 ms (web). Wasm worker — our existing Rust `argon2` crate
  competitive with `hash-wasm`/`argon2-browser`. Don't add a JS dep
  unless benchmarks force it.
- **Proper WS auth ticket exchange.** Browsers can't set
  `Authorization` on `WebSocket`, so slice 4 ships `?token=…` on the
  URL. Replace with HTTP-issued short-lived ticket → WS upgrade.
  Pulled forward when iOS/Android land.
- **DEK "stay logged in" path.** Browser holds DEK in memory only and
  re-derives from password each session. Web Crypto wrapped-key story
  for persistent unlock is deferred.

## Storage & persistence

- **Loro shallow snapshots** when `loro.bin` gets uncomfortable.
  One-line change to `Doc::save`.
- **OPFS torn-write hazard.** `createWritable → write → close` is
  non-atomic; a tab crash mid-write can lose the only good copy.
  Mitigation: incremental update log + periodic checkpoint
  (`exportFrom(version)` per flush, fresh shallow snapshot every N
  updates / M bytes, truncate log). Same shape the wire protocol
  already uses.
- **`HashMap<id, idx>` lookup cache** in `Doc` when `find_item` scan
  becomes a profiler hit. Rebuild on `Doc::load`, mutate on each op.
  ~30 LOC. Don't pre-optimize.
- **TTL-purge of old Done.** One-line follow-up if telemetry shows
  pain — `empty_bin` shape applied to Done past a cutoff.

## Web app

- **Multi-tab single-engine sharing.** Avoids duplicate WS sessions
  per account on one origin. Needs BroadcastChannel plumbing; not
  worth it yet.
- **Bin/Done restore UX.** Mechanism is trivial
  (`set_item_status(Live)`); the design call is which list it lands
  in. Items already keep their `list_id` per the data-model spec.
- **Touch / mobile DnD.** primavera-dnd is desktop-only currently.
- **Dnd renderer protocol — Solid-native rewrite.** Vanilla Dnd
  currently calls `renderer.mount(key, item, container)` per row,
  which forces every framework wrapper into one Solid root per row:
  context (`<ThemeContext.Provider>`, `<ErrorBoundary>`) doesn't
  cross, owner trees fragment, idiomatic patterns like
  `<For each={…}>` don't apply. Path: change the vanilla container's
  contract to expose "keys to render" as a signal-shaped data
  surface and let framework wrappers iterate via their native
  primitive. Solid wrapper becomes a single root with `<For>`;
  React/Svelte adapters get their own. Big change to primavera-ui
  but fixes the architectural smell properly. Time it to when we
  next touch the renderer protocol for another reason (row groups,
  sticky headers, expandable rows beyond what the current
  per-key-mount API handles).
- **Playwright / browser test harness.** Manual smoke today; not
  worth the harness setup until UI surface stabilises.
- **Done/Bin ordering stability.** `done_at` / `binned_at` are client
  clocks; skewed clocks across devices can briefly produce different
  orders. Acceptable; flag in code where the sort happens.

## Native clients

- **UniFFI bridge for iOS/Android.** Same `core` crate, generated
  Swift + Kotlin bindings. `ItemView` / `ListView` / `SyncEngine`
  cross the FFI as canonical types. Spin up when those slices start.
- **Password-derivation flow over UniFFI.** Same bindings as the
  engine.

## Testing

- **E2E matrix gaps from `spec/testing.md`.** Currently covered:
  signup→add→re-login→items intact (two-device test); two clients live
  convergence (broadcast test). Missing: offline-mutate-then-sync,
  both-offline-then-converge, snapshot-bootstrap-fresh-device,
  recovery-flow round-trip.

## Open questions (not tasks)

- **Conditional exports vs. two packages.** `airday-core-web` +
  `airday-core-node` instead of conditional exports on one package.
  Conditional exports is simpler now; splitting is cheap later.
- **Solid store granularity.** Single `createStore` keyed by id vs.
  per-item signals via `Map<id, signal>`. Defaulted to single store;
  revisit if reactivity costs surface.
