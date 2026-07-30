# TUI plan (and CLI load-time assessment)

Status: plan, not built. Written 2026-07-30 from an assessment of the current CLI. Companion to `spec/cli.md` (which anticipates this in "Sync lifecycle") and `spec/sync-protocol.md`.

## Where the CLI stands today

The CLI is not a different data model from the web app. Both hold the same persistent local Loro doc; the web keeps it live in memory for the life of the tab, while the CLI is one-shot and rebuilds it from `airday.sqlite` on every invocation:

1. `Session::open` (`cli/src/sync.rs`): read `config.toml` + `secrets.toml`. The DEK is stored directly, so there is no Argon2 at command time. This is why startup can be fast at all.
2. Open sqlite (WAL, migrations ledger check).
3. `boot_doc` (`core/src/storage.rs`): load the snapshot blob if any, then decrypt and Loro-import every op row past it, one blob at a time, with diff capture running, then discard the captured events.
4. Run the command against the in-memory doc.
5. `flush`: capture pending commits as one op row, then `snapshot_if_fully_synced(1)`, which folds the log into a fresh snapshot only if the outbox is empty, i.e. only once every op has been acked by the server.

### Measured (release build, synthetic profile, 2026-07-30, M-series mac)

| Scenario | mean |
|---|---|
| `airday --help` (bare startup: clap + tokio + tracing) | 3.4 ms |
| `airday ls`, empty/compacted doc | 4.4 ms |
| `airday ls`, 100 never-synced ops | 8.7 ms |
| `airday ls`, 500 never-synced ops | 66 ms |
| `airday ls`, 2000 never-synced ops | 1,162 ms |

2000 ops was ~748 KB of blobs, so the cost is not I/O or decryption; it is 2000 individual Loro imports (roughly O(N^1.6) observed). Mutation commands go through the identical `Session::open`, so they pay the same boot cost as reads.

### The trap: offline usage never compacts

The CLI is offline by default (correctly), but compaction requires a completed sync: `snapshot_if_fully_synced` no-ops while unacked ops remain, because pruning them would drop the outbox. So the default usage pattern (never passing `-s`, or a device offline for a while) grows the op log without bound, one row per command, and every command replays the whole log. A user who captures 2000 items without syncing waits over a second per `add`. After one successful sync the log folds and boot is back to ~4 ms; synced usage is already optimal.

`status` and `cache` deliberately never boot the doc and stay O(1) regardless of log size. Preserve this.

## Fixes, in order

### 1. Fold offline ops without waiting for acks

`force_snapshot` cannot be used on a syncing doc because it prunes unacked outbox rows. But the two concerns split: write a full-state snapshot while **keeping** the unacked op rows for the outbox. At next boot the snapshot already contains those ops' effects, and re-importing the retained rows is a no-op under Loro's version vector, so correctness holds; the outbox still pushes them on the next sync.

Cheapest trigger: in `Session::open`, after boot, if the replay length exceeded a threshold (~100 rows), write the fold before running the command. That caps worst-case boot at one snapshot import plus a bounded tail, forever, with no protocol changes.

Needs: a snapshot write mode (or `SnapshotCutoff` semantics) that records the fold point without pruning rows above the acked frontier, plus a boot path that tolerates re-importing already-folded rows (it does today; CRDT import is idempotent).

### 2. Batch and silence the boot replay

`boot_doc` imports blob-by-blob through `apply_remote_batch` with diff capture on, then drains and discards every event. Instead: decrypt all blobs, hand Loro a single batched import, and skip diff capture entirely at boot (there is no live UI to notify). Shaves the constant factor even before compaction kicks in.

### 3. Not worth much

Bare startup is 3.4 ms; nothing to do. A current-thread tokio runtime for offline commands is noise next to the above.

## TUI host design

The architecture is already TUI-ready; the work is a new host, not new engine machinery:

- `SyncEngine` is sans-IO; `Doc` mutates through `&self`; the `AppEvent` stream the web UI consumes for reactive updates works natively. The web host (`core/web`) is the template.
- Shape: hold the engine open for the life of the process; `select!` over UI events, WS frames, and a ~1 s persist tick. Persist via `capture_local_ops` on the tick; snapshot at threshold 250 on the hot path and 1 on exit (mirroring the web host's cadence).
- Surface `OpsBroadcast` reactively: apply frames as they arrive, translate to `AppEvent`s, redraw the affected rows.
- Concretely in `cli/src/sync.rs`, `Session` needs a persistent sibling: `flush` currently consumes `self`, and `recv_bytes` blocks with an effectively infinite timeout. Both are fine for one-shot commands and both get replaced by the select loop. Reconnect-with-backoff belongs to the host, not the engine (the engine just gets `handle_connected` again).
- Same `airday` binary (e.g. bare `airday` or `airday tui` launches it), per `spec/cli.md`.
- No daemon: with fix 1 in place a fresh TUI launch is single-digit milliseconds, so a resident process buys nothing. The daemon question stays deferred, per `spec/cli.md`.
