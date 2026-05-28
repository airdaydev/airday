# Sync Protocol

WebSocket per device. Frames are binary, MessagePack-encoded (`rmp-serde`). Each frame is a tagged enum (serde-internal-tag style) so the discriminator is part of the encoded value.

The unit of sync is the **doc**, not the account. A single WS connection is owned by a `(account, device)` pair and multiplexes sync for **N docs** the device is a member of. Every payload-carrying frame names a `doc_id`; the server fans broadcasts out per-doc, not per-account.

## Terminology

**Status:** Implemented.

The wire calls them "ops" (`PushOps`, `OpsAck`, `seq`, `since_seq`, `last_acked_seq`) but each one is an **encrypted op blob** — a single `EncryptedBlob` carrying a Loro update-pack that contains *1..N* CRDT operations. The client engine bundles every pending mutation since the last push into one blob per `PushOps`, so "1 seq" on the server ≈ "one push cycle" on the client, not "one user action".

Consequences worth remembering:

- Server-assigned `seq` enumerates *blobs*, not user actions. A user typing 1000 characters in one session and pressing flush once = 1 seq.
- `snapshot_threshold_blobs` (below) is in blob count, not action count or bytes.
- Compaction by `seq ≤ snapshot.compaction_floor_seq` deletes *whole blobs* — a single fat blob is uncompactable.
- `PushOps { doc_id, ops: [EncryptedBlob] }` accepts a vector, so the wire supports >1 blob per push even though the current engine sends one.

A future move to byte-based eligibility / compaction would close the asymmetry; tracked in `roadmap.md`.

## Per-doc `seq`

**Status:** Planned (v2). v1 ships per-account `seq`; v2 re-keys storage and frames on `doc_id`.

Server-assigned `seq` is **per-doc** and **dense / gap-free**. The server bumps a per-doc counter (`doc_sequences.next_seq` in sqlite; the same shape in Postgres) in the same transaction that inserts ops, so consecutive ops for one doc get consecutive seqs (1, 2, 3, …). Different docs have independent counters. Two ops pushed to two different docs on the same WS connection get unrelated seqs.

## Wire protocol versioning

**Status:** Planned. v1 (current) is per-account and frame-level `doc_id`-free; v2 is per-doc with `doc_id` on every payload-carrying frame. The version handshake (below) is the negotiation point. v2 is **not** wire-compatible with v1; servers may support both during a transition window but a single connection runs one version.

## Version handshake

**Status:** Implemented (v1); v2 negotiation is additive.

First frame on every WS connection, before any payload exchange:

- Client → Server: `Hello { client: "airday-cli", client_version: "0.1.0", supported_protocol_versions: [1, 2] }`
- Server → Client: `HelloAck { server_version: "0.1.0", protocol_version: 2 }` — server picks the highest version it shares with the client. If no overlap → `HelloRejected { reason }` and connection closes.

All subsequent frames are interpreted under the agreed `protocol_version`. Belt-and-braces against breaking changes; MessagePack handles additive evolution within a version on its own.

## Doc subscription

**Status:** Planned (v2).

A WS connection is implicitly subscribed to a doc the first time the server sees any payload frame from the client carrying that `doc_id`. Subscription persists for the connection lifetime; on disconnect all subscriptions are dropped. There is no explicit `Subscribe` / `Unsubscribe` frame in v2 — add one if/when needed.

Subscription only affects **broadcast fan-out** (the server forwards `OpsBroadcast { doc_id }` only to other devices currently subscribed to that doc). Access control is enforced on **every** frame regardless of subscription state: the server checks `doc_members(doc_id, account_id_of_connection)` and rejects with a connection-terminating error if the connection's account is not a current member.

## Client → Server

**Status:** Planned (v2); v1 frames differ in that they omit `doc_id`.

| Type | Body | Purpose |
|---|---|---|
| `PushOps` | `{ doc_id, ops: [EncryptedBlob] }` | Append ops to a doc. Server assigns per-doc seqs. |
| `PullOps` | `{ doc_id, since_seq: u64 }` | Request ops with seq > since_seq for a doc. |
| `Ack` | `{ doc_id, last_acked_seq: u64 }` | Advance this device's contiguous-prefix frontier for a doc. |
| `PushSnapshot` | `{ doc_id, up_to_seq: u64, compaction_floor_seq: u64, blob: EncryptedBlob }` | In response to `SnapshotRequest`. `up_to_seq` = encoded state frontier; `compaction_floor_seq` = echo of the server's requested compaction floor. |
| `PullSnapshot` | `{ doc_id }` | Request the latest snapshot blob for a doc. |

## Server → Client

**Status:** Planned (v2).

| Type | Body | Purpose |
|---|---|---|
| `OpsAck` | `{ doc_id, assigned_seqs: [u64] }` | Response to `PushOps`. `assigned_seqs[i]` corresponds to `ops[i]` in the request, in order. |
| `OpsBatch` | `{ doc_id, ops: [(u64, EncryptedBlob)], complete: bool }` | Response to `PullOps`; may chunk. Each tuple's `u64` is the per-doc `seq`. |
| `OpsBroadcast` | `{ doc_id, ops: [(u64, EncryptedBlob)] }` | Pushed when another device sends ops to this doc. |
| `SnapshotRequest` | `{ doc_id, up_to_seq: u64, compaction_floor_seq: u64 }` | Server asks a connected client to produce a snapshot for a doc. `up_to_seq` = state frontier to encode at (= the producer's `last_acked_seq` for this doc); `compaction_floor_seq` = seq at/below which op blobs become eligible for GC once this snapshot lands (= `max(horizon, prev compaction_floor_seq)` for this doc). |
| `Snapshot` | `{ doc_id, up_to_seq: u64, blob: EncryptedBlob }` | Response to `PullSnapshot`. `up_to_seq` is the encoded state frontier; the bootstrapping client uses it as its next `since_seq` for that doc. |
| `SnapshotRequired` | `{ doc_id, up_to_seq: u64 }` | Sent in lieu of `OpsBatch` when the client's `since_seq` is below the doc's latest snapshot's `compaction_floor_seq` — server can't serve the missing ops. Client must bootstrap from snapshot before resuming ops for that doc. `up_to_seq` is informational; the authoritative state frontier is the one returned in `Snapshot`. |

`EncryptedBlob = { nonce: bytes, ciphertext: bytes }`. The blob is encrypted with the **doc's DEK**, which the client holds locally after unwrapping its `doc_members.wrapped_dek` row at login time (see `encryption.md`). The server cannot decrypt blobs and does not need to know which DEK encrypted them — `doc_id` is solely a routing key.

## Ordering & ack flow

**Status:** Per-doc semantics are planned (v2). Engine logic (gap detection, contiguous-prefix ack) is implemented in v1 against per-account seqs; the algorithm is unchanged in v2, only the keying axis.

- Server orders ops by per-doc `seq` of arrival. Per-doc FIFO is the only ordering that matters — different docs' streams are independent, even on the same connection.
- Client decrypts ops and applies via Loro **immediately on receipt**, regardless of seq contiguity. Server `seq` is a *delivery* sequence, not a *causal* one; Loro's CRDT handles real causal ordering off the encoded VV. Applying out-of-order is safe and keeps the UI responsive under replica-lag conditions.
- Client sends `Ack { doc_id, last_acked_seq: last_contiguous_seq }` — the contiguous prefix from the persisted start, **per doc**. Server stores in `device_doc_frontiers.last_acked_seq` for the `(device_id, doc_id)` row.
- **Horizon** for a doc = `min(device_doc_frontiers.last_acked_seq)` across all `(device_id, doc_id)` rows where the device's account is a current member of the doc (`doc_members.removed_at IS NULL`). Drives the **op-blob compaction floor** (`compaction_floor_seq`) for that doc: every member-device has every op blob at or below the horizon, so those blobs are safe for server-side GC. This is purely seq-level bookkeeping — the server doesn't see Loro VVs and doesn't need to. Time-based eviction is deliberately *not* used to advance the horizon: deleting blobs a stale device hasn't acked would force a full bootstrap on its next reconnect even when the lag is small. The user-facing escape hatches are explicit device revoke via `DELETE /api/devices/:id` (which excludes that device's frontiers from every doc's horizon calc) and member removal via the sharing API (which excludes that account's devices from the affected doc's horizon).
- **`OpsBroadcast` is post-commit only.** Server fans out to other subscribed devices only after the originating `PushOps` is durable in storage. Otherwise a crash between broadcast and fsync could leave peers holding ops the sender will re-push (under new seqs) on reconnect.

## Contiguity & gap handling

**Status:** Planned (v2 per-doc) — and within v2, still planned as ahead-of-need work. Today the engine just advances to `max(seq seen)` and acks that; every subsection below describes future work. The mechanism exists in the spec ahead of need so the safety invariant is built *before* Postgres + replicas produce a real gap, not after.

Per-doc `seq` is dense and gap-free at the server. Any gap the client observes in the received stream for a doc is a real signal — replica lag (most common), dropped frame, or server-side data loss (rare, catastrophic). The engine's job is to detect gaps **per doc**, hold the ack for that doc at the safe boundary, fill the gap if possible, and escalate if not. Gap state is independent across docs — a stuck doc must not block ack progress on other docs sharing the connection.

### Engine state

One engine instance exists per doc; the state below is per engine, i.e. per doc:

- `last_contiguous_seq: u64` — highest seq such that **every** seq from the persisted start through it has been received. This is the value the engine puts in `Ack` frames and persists between sessions. Advances only over contiguous arrivals.
- `seen_above_contig: BTreeSet<u64>` — seqs received that are *above* `last_contiguous_seq + 1` (i.e., arrived before some lower seq). Tracks holes implicitly: any seq in `(last_contiguous_seq, max(seen_above_contig)]` not in the set is a hole.

On each received seq `n` for the engine's doc (from `OpsBatch` or `OpsBroadcast`):

1. Apply the blob to Loro immediately. (Loro tolerates out-of-order; CRDT VV handles causality.)
2. If `n == last_contiguous_seq + 1`, advance: `last_contiguous_seq = n`, then drain consecutive seqs from `seen_above_contig` (peel off the prefix that's now contiguous).
3. Else if `n > last_contiguous_seq + 1`, insert into `seen_above_contig`. Mark a `pending_gap_since` timestamp if not already set.
4. Else (`n <= last_contiguous_seq`), duplicate — discard.

`Ack { doc_id }` is queued whenever `last_contiguous_seq` advances and exceeds `last_sent_ack`, exactly as today — the only change is the source value and the doc qualifier.

### Buffer bound

If `seen_above_contig.len()` exceeds `MAX_REORDER_BUFFER` (default `10_000`) for a doc, the engine has accumulated too many out-of-order seqs without the gap closing. This is operationally indistinguishable from "the missing seq is never going to arrive" — escalate directly to the bootstrap path (§"Escalation"), skipping the retry tier. Prevents unbounded memory growth from a pathological upstream. Bound is per-doc.

### Escalation

Tiered response when `last_contiguous_seq` for a doc hasn't advanced despite a non-empty `seen_above_contig`:

1. **Retry (tolerate-and-poll).** After `GAP_RETRY_TIMEOUT` (default 3 s) of no advance with a non-empty buffer, re-issue `PullOps { doc_id, since_seq: last_contiguous_seq }`. This re-reads from whatever replica the new request lands on; if the missing seq has since replicated, it arrives and the buffer drains. Repeat up to `GAP_RETRY_LIMIT` (default 3) times with exponential backoff (3 s, 6 s, 12 s).
2. **Bootstrap.** If retries exhaust without closing the gap, request `PullSnapshot { doc_id }` and follow the snapshot bootstrap path (§"Bootstrap from snapshot"). The snapshot's `up_to_seq` covers the missing seq's payload as part of the encoded state; after applying, `last_contiguous_seq` is reset to the snapshot's `up_to_seq` and the engine resumes via `PullOps { doc_id }` from there. This handles "client fell far behind" and "compaction race" cases naturally.
3. **Hard stop.** If the hole is *above* the doc's latest snapshot's `up_to_seq` AND a direct `PullOps { doc_id, since_seq: last_contiguous_seq }` against primary confirms the seq is genuinely missing from the server's `ops` table, the per-doc dense-seq invariant has been violated server-side — data corruption, lost write, restored-from-stale-backup. The engine for that doc:
   - Stops syncing (no further `Ack` / `PushOps` for this doc).
   - Surfaces a structured error event to the host (`Event::SyncHalted { doc_id, reason: "server seq gap unrecoverable", missing_seq }`).
   - Local mutations continue to append to the doc / WAL — the client stays usable offline.
   - Other docs on the same connection are unaffected.

Hosts should render the hard-stop state to the user as something like *"Sync paused for this list — server inconsistency detected. Your changes are safe locally."* Do not silently retry; the invariant break is the point.

### Bootstrap on hard catastrophe

A reconnect after server-side restore-from-backup is the recovery path. The client never acked past the hole, so `since_seq = last_contiguous_seq` (per doc) re-pulls from the (now restored) data and the engine resumes normally. No special "recovery mode" client logic — the existing reconnect flow *is* the recovery flow, exactly because of the per-doc contiguous-prefix discipline.

### Testing

Three pieces of behavior worth covering with engine-level tests (no real network needed), each scoped to a single doc:

- **Gap fills naturally.** Deliver `[1, 2, 4]` for doc D, assert `Ack { doc_id: D }` carries 2 only. Deliver `[3]`, assert engine advances to 4 (peeling 4 from the buffer) and `Ack` now carries 4.
- **Retry on timeout.** Deliver `[1, 2, 4]` for D, advance simulated clock past `GAP_RETRY_TIMEOUT`, assert engine emits a fresh `PullOps { doc_id: D, since_seq: 2 }`.
- **Bootstrap on exhausted retries.** Deliver `[1, 2, 4]` for D, advance clock past all retries, assert engine transitions to `Bootstrapping` and emits `PullSnapshot { doc_id: D }`.

Plus one multi-doc test: gap on doc D must not stall ack/push on doc E sharing the same connection.

### Today vs future

Under the current sqlite single-writer + post-commit broadcast deployment, gaps are structurally impossible — every `OpsBatch` and `OpsBroadcast` is generated from a single linear writer and delivered on a single TCP connection. `seen_above_contig` should stay empty in production today. The mechanism exists *now* so the safety invariant is enforced *before* Postgres + replicas land, not after a real gap surfaces in production. A `tracing::warn!` on first non-empty insert into `seen_above_contig` is a useful early-warning signal that something has started producing out-of-order delivery.

## Commit origin tagging

**Status:** Implemented. `apply_remote` and WAL replay set origin `"remote"`; `UndoManager` excludes it via `add_exclude_origin_prefix("remote")`. Per-engine (i.e. per-doc) in both v1 and v2.

Every Loro commit carries an origin string. The engine uses two values:

- **`""`** (Loro default) — local mutations from the user. No explicit tag needed; `LoroDoc::commit()` already passes empty.
- **`"remote"`** — ops applied via `apply_remote()` after decrypting an inbound `OpsBatch`/`OpsBroadcast`. Set with `LoroDoc::import_with(bytes, "remote")`.

This exists so a future `UndoManager` can `exclude_origin_prefixes(["remote"])` and undo only the local user's edits, not concurrent remote ones. Origins are not synced; they're a local-only event filter (cf. Loro `set_next_commit_origin` docs). New non-local sources (snapshot bootstrap replay, schema migrations, etc.) get their own prefix as they appear — keep them disjoint from `"remote"` so undo policy can target them independently.

## Backpressure

**Status:** Chunk caps (500 ops / 256 KiB) are implemented in v1 server-side; algorithm is unchanged in v2 — just keyed per-doc. Ack decoupling is the engine's normal behavior in both versions.

`OpsBatch` chunks are sent **fire-and-forget** — the server emits them back-to-back without waiting for client acknowledgement. WebSocket sits on TCP, which has its own flow control: if the client can't drain its receive buffer fast enough (slow decrypt, low memory, paused tab), the TCP window closes and the server's `send` blocks. No application-level pacing required. This avoids paying RTT × chunk-count on catch-up — for a 10-chunk catch-up at 100 ms RTT, request-ack-request would burn 1 s of pure waiting; fire-and-forget burns 0.

The application-level `Ack { doc_id, last_acked_seq }` is **decoupled from chunk delivery**. It's emitted by the client *after* successfully applying ops to the local Loro doc, not on receipt of bytes. Server uses it only for horizon tracking; it does not gate further sends. This decoupling makes resume-after-disconnect correct: the client persists `last_acked_seq` (per doc) only after Loro accepts the op, so reconnecting with `since_seq = last_acked_seq` replays from the last *applied* op, not the last *delivered* one. No double-apply, no skipped ops.

The `complete: bool` on `OpsBatch` signals "no more chunks for this `PullOps`" — the client flushes its progress UI for that doc and considers the pull finished.

**Chunk size:** **500 ops or 256 KiB per `OpsBatch`, whichever hits first.** Sized to single-frame the common case (a session's worth of ops, or hours-away reconnect), give chunked progress UX for catch-up (thousands of ops → 5–10 frames), and stay well under WS frame caps that intermediaries enforce (~1 MiB at common proxies). The byte cap is a safety net against a future op type larger than expected. Cap is per-`OpsBatch` frame (per-doc); interleaving across docs is free because the server processes pulls independently per doc.

## Snapshot orchestration

**Status:** Planned (v2 per-doc). v1 implements the coordinator per-account; v2 rekeys to per-doc with no behavioral changes to the state machine itself.

Snapshotting is **server-orchestrated, per-doc, best-effort, and must never wedge sync**. It exists to bound bootstrap / compaction cost, not to gate normal operation.

A snapshot carries **two seqs** that serve unrelated jobs:

- **`up_to_seq`** — the snapshot's encoded *state* frontier for this doc. Determines what current state a bootstrapping client sees, and the value the client uses as `since_seq` for the post-bootstrap `PullOps { doc_id }`. Wants to be as recent as possible for bootstrap perf — ideally equal to the producer's `last_acked_seq` for the doc (and hence equal to `doc_last_seq` when the producer is fully caught up on it).
- **`compaction_floor_seq`** — the seq at/below which op blobs become eligible for server-side GC once this snapshot lands. Server-only bookkeeping; the producing client echoes it verbatim and the produced blob's contents do not depend on it. Doubles as the **bootstrap gate**: a `PullOps { doc_id, since_seq }` with `since_seq < compaction_floor_seq` is answered with `SnapshotRequired` because the requested ops may no longer exist. Monotonic across snapshots for a given doc — never regresses.

> Note: today's "snapshot" is a *full* Loro snapshot — no CRDT history is trimmed. The two seqs are about op-blob storage on the server, not Loro shallow-snapshot semantics. True shallow snapshotting (history trimming, with a VV horizon contributed by clients) is tracked in §"Shallow snapshots (future)".

Orchestration, **per doc**:

- Trigger: snapshot when **both**
  - `(doc_last_seq − latest_snapshot.up_to_seq) > snapshot_threshold_blobs` (default `10_000`, configurable via `snapshot_threshold_blobs` / `AIRDAY_SNAPSHOT_THRESHOLD_BLOBS`) — enough new state has accumulated for this doc that a new snapshot materially shortens a bootstrapping client's `PullOps` catch-up, and
  - the triggering device has `device_doc_frontiers.last_acked_seq = doc_last_seq` for this doc — that's what we set `up_to_seq` to, so the producer must be at that point to encode it. Lagging connections are skipped as producers but still contribute to horizon.
  Counts blobs, not user actions or bytes — see §"Terminology" for why that matters.
  Horizon is intentionally **not** a trigger condition. Snapshotting is valuable for bootstrap perf independent of compaction — a single snapshot row replaces an arbitrarily long `OpsBatch` replay. If horizon hasn't moved, the new snapshot's `compaction_floor_seq` is the same as the previous one, so compaction doesn't advance — but the new snapshot still cuts bootstrap cost.
- `up_to_seq` = the producer's `last_acked_seq` for the doc = `doc_last_seq` (since the producer is caught up).
- `compaction_floor_seq` = `max(horizon, previous_snapshot.compaction_floor_seq)` for this doc. Normally just horizon; the `max` enforces monotonicity for the edge case where a fresh device's join drops horizon below the existing floor — compaction is one-way, so the floor stays put.
- Production: server sends `SnapshotRequest { doc_id, up_to_seq, compaction_floor_seq }`. Client serializes a full Loro snapshot for that doc at `up_to_seq`, encrypts with the doc's DEK, uploads via `PushSnapshot { doc_id, up_to_seq, compaction_floor_seq, blob }`. `compaction_floor_seq` is echoed unchanged — the client does not interpret it.
- Compaction: after a snapshot is durable, compaction may delete ops with `doc_id = X AND seq ≤ snapshot.compaction_floor_seq`.

Server keeps **at most one in-flight snapshot request per doc**:

- State, per `doc_id`:
  - `Idle`
  - `Requested { device_id, up_to_seq, deadline }`
- Transition to `Requested` only when no request is already in flight for that doc.
- Snapshot orchestration is per-doc; one stuck or slow doc must not block others, even across docs sharing devices.

Request lifecycle:

- When threshold is crossed for a doc and the doc is `Idle`, server picks the best currently connected candidate device (subscribed to that doc and caught up to `doc_last_seq`) and sends `SnapshotRequest { doc_id }`.
- If no eligible connected candidate exists for that doc, server stays `Idle` for that doc. Snapshotting is deferred until a later doc event (subscribe, ack advance, new op, explicit retry tick, etc.) gives the server a reason to try again.
- While `Requested`, server does **not** open a second concurrent request for that doc.
- On successful `PushSnapshot`, server durably stores the snapshot, clears the in-flight request for that doc, then re-evaluates whether the doc is still above threshold.

Failure handling:

- If the assigned connection disconnects before a matching `PushSnapshot` arrives, server clears that in-flight request immediately and tries the next-best currently connected candidate for that doc, if any.
- If the request deadline expires (start with a coarse fixed timeout such as 5 minutes), server clears that in-flight request and tries the next-best currently connected candidate for that doc, if any.
- If no replacement candidate exists after disconnect/timeout, server returns the doc to `Idle`. Sync continues normally; snapshotting waits for a later retry opportunity.
- Snapshotting is therefore **retryable but not blocking**: inability to get a snapshot may delay compaction for that doc, but must not break push/pull/ack on it or any other doc.

Correctness / acceptance rules:

- `PushSnapshot { doc_id }` is accepted only if it matches the **current** in-flight request for that doc/device.
- Late snapshots from a timed-out, disconnected, or superseded assignee are ignored.
- Unsolicited snapshots (no in-flight request for that doc) are ignored.
- Server stores only the latest durable snapshot per doc; no multi-snapshot chain is required.
- The uploaded `up_to_seq` must be **at least** the requested `up_to_seq`, and `compaction_floor_seq` must equal the requested value (the server is asserting a specific compaction floor, not a range). Mismatched snapshots are ignored.
- A newer snapshot may replace an older one atomically once durable.

Operational notes:

- Keep the policy coarse. One candidate at a time per doc, one deadline, one retry decision per failure is enough.
- Large docs increase snapshot upload/download cost, but do **not** change the orchestration model.
- Server should log: request issued, request timed out, assignee disconnected, snapshot accepted, snapshot ignored as stale/mismatched, and retry abandoned for lack of candidates — all tagged with `doc_id`.

## Shallow snapshots (future)

**Status:** Not implemented. The server's `compaction_floor_seq` exists today (it gates op-blob GC) but it does **not** drive Loro history trimming. The "snapshot" the client produces is a full Loro snapshot.

Loro shallow snapshotting — `ExportMode::shallow_snapshot(frontier)` — trims CRDT history at a *version vector* (Loro Frontiers), not at a server seq. A server seq enumerates encrypted blobs in delivery order and has no exposed mapping to peer/counter pairs inside any blob (the server can't decrypt). So a seq cannot be handed to Loro as a shallow boundary.

The planned design decouples the two horizons rather than trying to translate between them, **per doc**:

- **Op-blob horizon (existing).** `min(device_doc_frontiers.last_acked_seq)` across member-devices → `compaction_floor_seq` for the doc. Drives server-side op-blob GC. Server reads this directly from `device_doc_frontiers`.
- **VV horizon (planned).** Each device periodically reports its current Loro VV/Frontiers per doc to the server (e.g. piggybacked on `Ack`, or via a dedicated `ReportVV { doc_id, vv }` frame on a coarse cadence — single-digit minutes is fine; this isn't on the hot path). Server stores the latest VV per `(device, doc)` and computes the **VV meet** across member-devices when it needs to issue a shallow snapshot for that doc. The meet is sent in `SnapshotRequest { doc_id }` alongside the existing fields; the producing client passes it to `ExportMode::shallow_snapshot(frontier)`.

Open questions, parked until this lands:

- Encoding of Loro Frontiers on the wire — Loro provides a canonical byte form; we just need to confirm it round-trips through MessagePack as opaque `bytes`.
- Report cadence: ack-piggyback vs. dedicated frame, and whether to throttle further when the doc is idle.
- Whether the snapshot envelope persists the producer's VV alongside the blob, or relies on Loro to recover it from the blob on import.

Until shallow snapshotting ships, the producer's snapshot blob is full-history and `compaction_floor_seq` only affects whether/when op rows get deleted on the server.

## Bootstrap from snapshot

**Status:** Partial (v1, per-account). Server-prompted path (`SnapshotRequired` → `PullSnapshot` → `Snapshot` → resume `PullOps`) is implemented and covered by the `produce_then_bootstrap_round_trip` test. The client-driven entry from §"Contiguity & gap handling" escalation is planned. v2 rekeys all of this per-doc.

A device whose `since_seq` for a doc is below that doc's latest snapshot's `compaction_floor_seq` cannot resume from ops alone — the ops it needs have been compacted. (Devices whose `since_seq` is between `compaction_floor_seq` and `up_to_seq` *can* still delta-pull, because those ops are preserved by horizon-bounded compaction.) On receiving a `PullOps { doc_id, since_seq }` with `since_seq < compaction_floor_seq`, the server replies `SnapshotRequired { doc_id, up_to_seq }` instead of `OpsBatch`. The client then:

1. `PullSnapshot { doc_id }` → server returns `Snapshot { doc_id, up_to_seq, blob }`.
2. Decrypt the blob with the doc's DEK and apply it to the local doc (Loro merges — local-only commits not yet pushed are preserved automatically; CRDT op-id reconciliation handles overlap with the device's own prior contributions).
3. `PullOps { doc_id, since_seq: up_to_seq }` to catch up on any ops written after the snapshot was taken.

The `up_to_seq` carried by `SnapshotRequired` is informational; the authoritative value is the one returned in the `Snapshot` frame, since the latest snapshot for the doc may advance between the two round trips.

`SnapshotRequired` and `Snapshot` are only valid in the bootstrap path for a doc. Up-to-date doc engines in steady state never receive either — `OpsBatch` / `OpsBroadcast` covers them. The `Snapshot` frame is therefore only accepted by a doc engine in its bootstrap state, never mid-pull. Different docs on the same connection may be in different states simultaneously.

**Bootstrap can also be entered client-driven**, not just in response to `SnapshotRequired`. The gap-handling escalation ladder (§"Contiguity & gap handling") transitions the doc's engine into `Bootstrapping` and emits `PullSnapshot { doc_id }` directly when a hole fails to close after retries. The server-side path is the same from `PullSnapshot` onward — it doesn't care whether the bootstrap was server-prompted or client-prompted.

## Reconnect

**Status:** Partial (v1). Resume-from-`last_acked_seq` is implemented in both CLI and web engines per-account; v2 generalizes to per-doc. Exponential backoff with jitter is implemented in the JS sync bridge (`js/core/src/sync-bridge.ts`); the CLI runs one-shot so backoff doesn't apply there.

Client maintains `last_acked_seq` per doc in local state. On reconnect: WS upgrade with token → for each doc the device is a member of and wants to keep current, issue `PullOps { doc_id, since_seq: last_acked_seq[doc_id] }` → resume. Docs the client doesn't actively need (e.g. archived shared docs) need not be pulled on reconnect — pull is lazy.

Exponential backoff 1s → 30s, per connection (not per doc).
