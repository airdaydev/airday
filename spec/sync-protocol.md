# Sync Protocol

WebSocket per device. Frames are binary, MessagePack-encoded (`rmp-serde`). Each frame is a tagged enum (serde-internal-tag style) so the discriminator is part of the encoded value.

## Terminology

**Status:** Implemented.

The wire calls them "ops" (`PushOps`, `OpsAck`, `seq`, `since_seq`, `last_acked_seq`) but each one is an **encrypted op blob** — a single `EncryptedBlob` carrying a Loro update-pack that contains *1..N* CRDT operations. The client engine bundles every pending mutation since the last push into one blob per `PushOps`, so "1 seq" on the server ≈ "one push cycle" on the client, not "one user action".

Consequences worth remembering:

- Server-assigned `seq` enumerates *blobs*, not user actions. A user typing 1000 characters in one session and pressing flush once = 1 seq.
- `snapshot_threshold_blobs` (below) is in blob count, not action count or bytes.
- Compaction by `seq ≤ snapshot.shallow_start_seq` deletes *whole blobs* — a single fat blob is uncompactable.
- `PushOps { ops: [EncryptedBlob] }` accepts a vector, so the wire supports >1 blob per push even though the current engine sends one.

A future move to byte-based eligibility / compaction would close the asymmetry; tracked in `roadmap.md`.

## Per-account `seq`

**Status:** Implemented.

Server-assigned `seq` is **per-account** and **dense / gap-free**. The server bumps a per-account counter (`account_sequences.next_seq` in sqlite; the same shape in Postgres) in the same transaction that inserts ops, so consecutive ops for one account get consecutive seqs (1, 2, 3, …). Different accounts have independent counters.

## Version handshake

**Status:** Implemented.

First frame on every WS connection, before any payload exchange:

- Client → Server: `Hello { client: "airday-cli", client_version: "0.1.0", supported_protocol_versions: [1] }`
- Server → Client: `HelloAck { server_version: "0.1.0", protocol_version: 1 }` — server picks the highest version it shares with the client. If no overlap → `HelloRejected { reason }` and connection closes.

All subsequent frames are interpreted under the agreed `protocol_version`. Belt-and-braces against breaking changes; MessagePack handles additive evolution within a version on its own.

## Client → Server

**Status:** Implemented.

| Type | Body | Purpose |
|---|---|---|
| `PushOps` | `{ ops: [EncryptedBlob] }` | Append ops. Server assigns per-account seqs. |
| `PullOps` | `{ since_seq: u64 }` | Request ops with seq > since_seq. |
| `Ack` | `{ last_acked_seq: u64 }` | Advance this device's contiguous-prefix frontier. |
| `PushSnapshot` | `{ up_to_seq: u64, shallow_start_seq: u64, blob: EncryptedBlob }` | In response to `SnapshotRequest`. `up_to_seq` = encoded state frontier; `shallow_start_seq` = retained-history start (compaction floor). |
| `PullSnapshot` | `{}` | Request the latest snapshot blob. |

## Server → Client

**Status:** Implemented.

| Type | Body | Purpose |
|---|---|---|
| `OpsAck` | `{ assigned_seqs: [u64] }` | Response to `PushOps`. `assigned_seqs[i]` corresponds to `ops[i]` in the request, in order. |
| `OpsBatch` | `{ ops: [(u64, EncryptedBlob)], complete: bool }` | Response to `PullOps`; may chunk. Each tuple's `u64` is the per-account `seq`. |
| `OpsBroadcast` | `{ ops: [(u64, EncryptedBlob)] }` | Pushed when another device sends ops. |
| `SnapshotRequest` | `{ up_to_seq: u64, shallow_start_seq: u64 }` | Server asks a connected client to produce a snapshot. `up_to_seq` = state frontier to encode at (= the producer's `last_acked_seq`); `shallow_start_seq` = where the snapshot's retained history starts (= horizon). |
| `Snapshot` | `{ up_to_seq: u64, blob: EncryptedBlob }` | Response to `PullSnapshot`. `up_to_seq` is the encoded state frontier; the bootstrapping client uses it as its next `since_seq`. |
| `SnapshotRequired` | `{ up_to_seq: u64 }` | Sent in lieu of `OpsBatch` when the client's `since_seq` is below the latest snapshot's `shallow_start_seq` (compaction floor — server can't serve the missing ops). Client must bootstrap from snapshot before resuming ops. `up_to_seq` is informational; the authoritative state frontier is the one returned in `Snapshot`. |

`EncryptedBlob = { nonce: bytes, ciphertext: bytes }`.

## Ordering & ack flow

**Status:** Implemented. Engine field is named `last_contiguous_seq` but currently advances to `max(seq seen)` — correct today because sqlite single-writer + single TCP connection makes gaps structurally impossible. The split between "applied" and "contiguous" only becomes load-bearing once §"Contiguity & gap handling" lands.

- Server orders ops by per-account `seq` of arrival. Per-account FIFO is the only ordering that matters — different accounts' streams are independent.
- Client decrypts ops and applies via Loro **immediately on receipt**, regardless of seq contiguity. Server `seq` is a *delivery* sequence, not a *causal* one; Loro's CRDT handles real causal ordering off the encoded VV. Applying out-of-order is safe and keeps the UI responsive under replica-lag conditions.
- Client sends `Ack { last_acked_seq: last_contiguous_seq }` — the contiguous prefix from the persisted start. Server stores in `devices.last_acked_seq`.
- **Horizon** = `min(last_acked_seq)` across all non-revoked devices for the account. Equivalent to the meet of all device VVs at that point — the server doesn't need to see Loro VVs because every device by definition has every op up to the horizon. Time-based eviction is deliberately *not* used to advance the horizon: a Loro shallow snapshot taken past a device's frontier produces ops the stale device can't merge back when it eventually reconnects (Loro rejects updates concurrent to the shallow start frontier; they sit in `ImportStatus.pending` forever). The user-facing escape hatch is explicit revoke via `DELETE /api/devices/:id` — revoking a stale device immediately drops it from the horizon calc, unblocking compaction.
- **`OpsBroadcast` is post-commit only.** Server fans out to other devices only after the originating `PushOps` is durable in storage. Otherwise a crash between broadcast and fsync could leave peers holding ops the sender will re-push (under new seqs) on reconnect.

## Contiguity & gap handling

**Status:** Planned — not yet implemented. Today the engine just advances to `max(seq seen)` and acks that; every subsection below describes future work. The mechanism exists in the spec ahead of need so the safety invariant is built *before* Postgres + replicas produce a real gap, not after.

Per-account `seq` is dense and gap-free at the server. Any gap the client observes in the received stream is a real signal — replica lag (most common), dropped frame, or server-side data loss (rare, catastrophic). The engine's job is to detect gaps, hold the ack at the safe boundary, fill the gap if possible, and escalate if not.

### Engine state

Two values per session:

- `last_contiguous_seq: u64` — highest seq such that **every** seq from the persisted start through it has been received. This is the value the engine puts in `Ack` frames and persists between sessions. Advances only over contiguous arrivals.
- `seen_above_contig: BTreeSet<u64>` — seqs received that are *above* `last_contiguous_seq + 1` (i.e., arrived before some lower seq). Tracks holes implicitly: any seq in `(last_contiguous_seq, max(seen_above_contig)]` not in the set is a hole.

On each received seq `n` (from `OpsBatch` or `OpsBroadcast`):

1. Apply the blob to Loro immediately. (Loro tolerates out-of-order; CRDT VV handles causality.)
2. If `n == last_contiguous_seq + 1`, advance: `last_contiguous_seq = n`, then drain consecutive seqs from `seen_above_contig` (peel off the prefix that's now contiguous).
3. Else if `n > last_contiguous_seq + 1`, insert into `seen_above_contig`. Mark a `pending_gap_since` timestamp if not already set.
4. Else (`n <= last_contiguous_seq`), duplicate — discard.

`Ack` is queued whenever `last_contiguous_seq` advances and exceeds `last_sent_ack`, exactly as today — the only change is the source value.

### Buffer bound

If `seen_above_contig.len()` exceeds `MAX_REORDER_BUFFER` (default `10_000`), the engine has accumulated too many out-of-order seqs without the gap closing. This is operationally indistinguishable from "the missing seq is never going to arrive" — escalate directly to the bootstrap path (§"Escalation"), skipping the retry tier. Prevents unbounded memory growth from a pathological upstream.

### Escalation

Tiered response when `last_contiguous_seq` hasn't advanced despite a non-empty `seen_above_contig`:

1. **Retry (tolerate-and-poll).** After `GAP_RETRY_TIMEOUT` (default 3 s) of no advance with a non-empty buffer, re-issue `PullOps { since_seq: last_contiguous_seq }`. This re-reads from whatever replica the new request lands on; if the missing seq has since replicated, it arrives and the buffer drains. Repeat up to `GAP_RETRY_LIMIT` (default 3) times with exponential backoff (3 s, 6 s, 12 s).
2. **Bootstrap.** If retries exhaust without closing the gap, request `PullSnapshot` and follow the snapshot bootstrap path (§"Bootstrap from snapshot"). The snapshot's `up_to_seq` covers the missing seq's payload as part of the encoded state; after applying, `last_contiguous_seq` is reset to the snapshot's `up_to_seq` and the engine resumes via `PullOps` from there. This handles "client fell far behind" and "compaction race" cases naturally.
3. **Hard stop.** If the hole is *above* the latest snapshot's `up_to_seq` AND a direct `PullOps { since_seq: last_contiguous_seq }` against primary confirms the seq is genuinely missing from the server's `ops` table, the per-account dense-seq invariant has been violated server-side — data corruption, lost write, restored-from-stale-backup. The engine:
   - Stops syncing (no further `Ack` / `PushOps`).
   - Surfaces a structured error event to the host (`Event::SyncHalted { reason: "server seq gap unrecoverable", missing_seq }`).
   - Local mutations continue to append to the doc / WAL — the client stays usable offline. Recovery is operational (server restore from backup), not protocol-level.

Hosts should render the hard-stop state to the user as something like *"Sync paused — server inconsistency detected. Your changes are safe locally."* Do not silently retry; the invariant break is the point.

### Bootstrap on hard catastrophe

A reconnect after server-side restore-from-backup is the recovery path. The client never acked past the hole, so `since_seq = last_contiguous_seq` re-pulls from the (now restored) data and the engine resumes normally. No special "recovery mode" client logic — the existing reconnect flow *is* the recovery flow, exactly because of the contiguous-prefix discipline.

### Testing

Three pieces of behavior worth covering with engine-level tests (no real network needed):

- **Gap fills naturally.** Deliver `[1, 2, 4]`, assert `Ack` carries 2 only. Deliver `[3]`, assert engine advances to 4 (peeling 4 from the buffer) and `Ack` now carries 4.
- **Retry on timeout.** Deliver `[1, 2, 4]`, advance simulated clock past `GAP_RETRY_TIMEOUT`, assert engine emits a fresh `PullOps { since_seq: 2 }`.
- **Bootstrap on exhausted retries.** Deliver `[1, 2, 4]`, advance clock past all retries, assert engine transitions to `Bootstrapping` and emits `PullSnapshot`.

### Today vs future

Under the current sqlite single-writer + post-commit broadcast deployment, gaps are structurally impossible — every `OpsBatch` and `OpsBroadcast` is generated from a single linear writer and delivered on a single TCP connection. `seen_above_contig` should stay empty in production today. The mechanism exists *now* so the safety invariant is enforced *before* Postgres + replicas land, not after a real gap surfaces in production. A `tracing::warn!` on first non-empty insert into `seen_above_contig` is a useful early-warning signal that something has started producing out-of-order delivery.

## Commit origin tagging

**Status:** Implemented. `apply_remote` and WAL replay set origin `"remote"`; `UndoManager` excludes it via `add_exclude_origin_prefix("remote")`.

Every Loro commit carries an origin string. The engine uses two values:

- **`""`** (Loro default) — local mutations from the user. No explicit tag needed; `LoroDoc::commit()` already passes empty.
- **`"remote"`** — ops applied via `apply_remote()` after decrypting an inbound `OpsBatch`/`OpsBroadcast`. Set with `LoroDoc::import_with(bytes, "remote")`.

This exists so a future `UndoManager` can `exclude_origin_prefixes(["remote"])` and undo only the local user's edits, not concurrent remote ones. Origins are not synced; they're a local-only event filter (cf. Loro `set_next_commit_origin` docs). New non-local sources (snapshot bootstrap replay, schema migrations, etc.) get their own prefix as they appear — keep them disjoint from `"remote"` so undo policy can target them independently.

## Backpressure

**Status:** Implemented. Chunk caps (500 ops / 256 KiB) are enforced in `server::sync::queries::fetch_ops_batch`; ack decoupling is the engine's normal behavior.

`OpsBatch` chunks are sent **fire-and-forget** — the server emits them back-to-back without waiting for client acknowledgement. WebSocket sits on TCP, which has its own flow control: if the client can't drain its receive buffer fast enough (slow decrypt, low memory, paused tab), the TCP window closes and the server's `send` blocks. No application-level pacing required. This avoids paying RTT × chunk-count on catch-up — for a 10-chunk catch-up at 100 ms RTT, request-ack-request would burn 1 s of pure waiting; fire-and-forget burns 0.

The application-level `Ack { last_acked_seq }` is **decoupled from chunk delivery**. It's emitted by the client *after* successfully applying ops to the local Loro doc, not on receipt of bytes. Server uses it only for horizon tracking; it does not gate further sends. This decoupling makes resume-after-disconnect correct: the client persists `last_acked_seq` only after Loro accepts the op, so reconnecting with `since_seq = last_acked_seq` replays from the last *applied* op, not the last *delivered* one. No double-apply, no skipped ops.

The `complete: bool` on `OpsBatch` signals "no more chunks for this `PullOps`" — the client flushes its progress UI and considers the pull finished.

**Chunk size:** **500 ops or 256 KiB per `OpsBatch`, whichever hits first.** Sized to single-frame the common case (a session's worth of ops, or hours-away reconnect), give chunked progress UX for catch-up (thousands of ops → 5–10 frames), and stay well under WS frame caps that intermediaries enforce (~1 MiB at common proxies). The byte cap is a safety net against a future op type larger than expected.

## Snapshot orchestration

**Status:** Implemented. `SnapshotCoordinator` enforces the lease/trigger model; `push_snapshot` in `ws.rs` accepts only matching in-flight requests; opportunistic compaction runs after each accepted snapshot.

Snapshotting is **server-orchestrated, best-effort, and must never wedge sync**. It exists to bound bootstrap / compaction cost, not to gate normal operation.

A snapshot carries **two frontiers** (the two-frontier model maps directly onto Loro's shallow-snapshot primitive):

- **`up_to_seq`** — the snapshot's encoded *state* frontier. Determines what current state a bootstrapping client sees, and the value the client uses as `since_seq` for the post-bootstrap `PullOps`. Wants to be as recent as possible for bootstrap perf — ideally equal to the producer's `last_acked_seq` (and hence equal to `server_last_seq` when the producer is fully caught up).
- **`shallow_start_seq`** — where the snapshot's retained history begins. Loro keeps every op between `shallow_start_seq` and `up_to_seq` individually addressable; ops below `shallow_start_seq` are trimmed. **Must be ≤ horizon** so any device's offline-made commits (which causally depend on its `last_acked_seq ≥ horizon`) remain mergeable on peers that bootstrap from this snapshot. Doubles as the **compaction floor**: ops with `seq ≤ shallow_start_seq` are deletable. Monotonic across snapshots — never regresses (see below).

Orchestration:

- Trigger: snapshot when **both**
  - `(server_last_seq − latest_snapshot.up_to_seq) > snapshot_threshold_blobs` (default `10_000`, configurable via `snapshot_threshold_blobs` / `AIRDAY_SNAPSHOT_THRESHOLD_BLOBS`) — enough new state has accumulated that a new snapshot materially shortens a bootstrapping client's `PullOps` catch-up, and
  - the triggering device is caught up to `server_last_seq` — that's what we set `up_to_seq` to, so the producer must be at that point to encode it. Lagging connections are skipped as producers but still contribute to horizon.
  Counts blobs, not user actions or bytes — see §"Terminology" for why that matters.
  Horizon is intentionally **not** a trigger condition. Snapshotting is valuable for bootstrap perf independent of compaction — a single snapshot row replaces an arbitrarily long `OpsBatch` replay. If horizon hasn't moved, the new snapshot's `shallow_start_seq` is the same as the previous one, so compaction doesn't advance — but the new snapshot still cuts bootstrap cost.
- `up_to_seq` = the producer's `last_acked_seq` = `server_last_seq` (since the producer is caught up).
- `shallow_start_seq` = `max(horizon, previous_snapshot.shallow_start_seq)`. Normally just horizon; the `max` enforces monotonicity for the edge case where a fresh device's join drops horizon below the existing floor — compaction is one-way, so the floor stays put.
- Production: server sends `SnapshotRequest { up_to_seq, shallow_start_seq }`. Client serializes a Loro shallow snapshot — state at `up_to_seq`, retained-history start at `shallow_start_seq` — encrypts with DEK, uploads via `PushSnapshot { up_to_seq, shallow_start_seq, blob }`.
- Compaction: after a snapshot is durable, compaction may delete ops with `seq ≤ snapshot.shallow_start_seq`.

Server keeps **at most one in-flight snapshot request per account**:

- State:
  - `Idle`
  - `Requested { device_id, up_to_seq, deadline }`
- Transition to `Requested` only when no request is already in flight.
- Snapshot orchestration is per-account; one stuck or slow account must not block others.

Request lifecycle:

- When threshold is crossed and the account is `Idle`, server picks the best currently connected candidate and sends `SnapshotRequest`.
- If no eligible connected candidate exists, server stays `Idle`. Snapshotting is deferred until a later account event (connect, ack advance, new op, explicit retry tick, etc.) gives the server a reason to try again.
- While `Requested`, server does **not** open a second concurrent request for that account.
- On successful `PushSnapshot`, server durably stores the snapshot, clears the in-flight request, then re-evaluates whether the account is still above threshold.

Failure handling:

- If the assigned connection disconnects before a matching `PushSnapshot` arrives, server clears that in-flight request immediately and tries the next-best currently connected candidate, if any.
- If the request deadline expires (start with a coarse fixed timeout such as 5 minutes), server clears that in-flight request and tries the next-best currently connected candidate, if any.
- If no replacement candidate exists after disconnect/timeout, server returns to `Idle`. Sync continues normally; snapshotting waits for a later retry opportunity.
- Snapshotting is therefore **retryable but not blocking**: inability to get a snapshot may delay compaction, but must not break push/pull/ack.

Correctness / acceptance rules:

- `PushSnapshot` is accepted only if it matches the **current** in-flight request for that account/device.
- Late snapshots from a timed-out, disconnected, or superseded assignee are ignored.
- Unsolicited snapshots (no in-flight request) are ignored.
- Server stores only the latest durable snapshot; no multi-snapshot chain is required.
- The uploaded `up_to_seq` must be **at least** the requested `up_to_seq`, and `shallow_start_seq` must equal the requested value (the server is asserting a specific compaction floor, not a range). Mismatched snapshots are ignored.
- A newer snapshot may replace an older one atomically once durable.

Operational notes:

- Keep the policy coarse. One candidate at a time, one deadline, one retry decision per failure is enough.
- Large accounts increase snapshot upload/download cost, but do **not** change the orchestration model.
- Server should log: request issued, request timed out, assignee disconnected, snapshot accepted, snapshot ignored as stale/mismatched, and retry abandoned for lack of candidates.

## Bootstrap from snapshot

**Status:** Partial. Server-prompted path (`SnapshotRequired` → `PullSnapshot` → `Snapshot` → resume `PullOps`) is implemented and covered by the `produce_then_bootstrap_round_trip` test. The client-driven entry from §"Contiguity & gap handling" escalation is planned.

A device whose `since_seq` is below the latest snapshot's `shallow_start_seq` cannot resume from ops alone — the ops it needs have been compacted. (Devices whose `since_seq` is between `shallow_start_seq` and `up_to_seq` *can* still delta-pull, because those ops are preserved by horizon-bounded compaction.) On receiving a `PullOps` with `since_seq < shallow_start_seq`, the server replies `SnapshotRequired { up_to_seq }` instead of `OpsBatch`. The client then:

1. `PullSnapshot` → server returns `Snapshot { up_to_seq, blob }`.
2. Decrypt the blob and apply it to the local doc (Loro merges — local-only commits not yet pushed are preserved automatically; CRDT op-id reconciliation handles overlap with the device's own prior contributions).
3. `PullOps { since_seq: up_to_seq }` to catch up on any ops written after the snapshot was taken.

The `up_to_seq` carried by `SnapshotRequired` is informational; the authoritative value is the one returned in the `Snapshot` frame, since the latest snapshot may advance between the two round trips.

`SnapshotRequired` and `Snapshot` are only valid in the bootstrap path. Up-to-date devices in steady state never receive either — `OpsBatch` / `OpsBroadcast` covers them. The `Snapshot` frame is therefore only accepted by a client in its bootstrap state, never mid-pull.

**Bootstrap can also be entered client-driven**, not just in response to `SnapshotRequired`. The gap-handling escalation ladder (§"Contiguity & gap handling") transitions the engine into `Bootstrapping` and emits `PullSnapshot` directly when a hole fails to close after retries. The server-side path is the same from `PullSnapshot` onward — it doesn't care whether the bootstrap was server-prompted or client-prompted.

## Reconnect

**Status:** Partial. Resume-from-`last_acked_seq` is implemented in both CLI and web engines. Exponential backoff with jitter is implemented in the JS sync bridge (`js/core/src/sync-bridge.ts`); the CLI runs one-shot so backoff doesn't apply there.

Client maintains `last_acked_seq` in local state. On reconnect: WS upgrade with token → `PullOps { since_seq: last_acked_seq }` → resume.

Exponential backoff 1s → 30s.
