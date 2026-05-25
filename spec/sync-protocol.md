# Sync Protocol

WebSocket per device. Frames are binary, MessagePack-encoded (`rmp-serde`). Each frame is a tagged enum (serde-internal-tag style) so the discriminator is part of the encoded value.

## Terminology

The wire calls them "ops" (`PushOps`, `OpsAck`, `op_id`, `since_op_id`, `last_acked_op_id`) but each one is an **encrypted op blob** — a single `EncryptedBlob` carrying a Loro update-pack that contains *1..N* CRDT operations. The client engine bundles every pending mutation since the last push into one blob per `PushOps`, so "1 op id" on the server ≈ "one push cycle" on the client, not "one user action".

Consequences worth remembering:

- Server-assigned `op_id` enumerates *blobs*, not user actions. A user typing 1000 characters in one session and pressing flush once = 1 op id.
- `snapshot_threshold_blobs` (below) is in blob count, not action count or bytes.
- Compaction by `op_id ≤ snapshot.shallow_start_op_id` deletes *whole blobs* — a single fat blob is uncompactable.
- `PushOps { ops: [EncryptedBlob] }` accepts a vector, so the wire supports >1 blob per push even though the current engine sends one.

A future move to byte-based eligibility / compaction would close the asymmetry; tracked in `roadmap.md`.

## Version handshake

First frame on every WS connection, before any payload exchange:

- Client → Server: `Hello { client: "airday-cli", client_version: "0.1.0", supported_protocol_versions: [1] }`
- Server → Client: `HelloAck { server_version: "0.1.0", protocol_version: 1 }` — server picks the highest version it shares with the client. If no overlap → `HelloRejected { reason }` and connection closes.

All subsequent frames are interpreted under the agreed `protocol_version`. Belt-and-braces against breaking changes; MessagePack handles additive evolution within a version on its own.

## Client → Server

| Type | Body | Purpose |
|---|---|---|
| `PushOps` | `{ ops: [EncryptedBlob] }` | Append ops. Server assigns ids. |
| `PullOps` | `{ since_op_id: u64 }` | Request ops with id > since_op_id. |
| `Ack` | `{ last_acked_op_id: u64 }` | Advance this device's frontier. |
| `PushSnapshot` | `{ up_to_op_id: u64, shallow_start_op_id: u64, blob: EncryptedBlob }` | In response to `SnapshotRequest`. `up_to_op_id` = encoded state frontier; `shallow_start_op_id` = retained-history start (compaction floor). |
| `PullSnapshot` | `{}` | Request the latest snapshot blob. |

## Server → Client

| Type | Body | Purpose |
|---|---|---|
| `OpsAck` | `{ assigned_ids: [u64] }` | Response to `PushOps`. |
| `OpsBatch` | `{ ops: [(u64, EncryptedBlob)], complete: bool }` | Response to `PullOps`; may chunk. |
| `OpsBroadcast` | `{ ops: [(u64, EncryptedBlob)] }` | Pushed when another device sends ops. |
| `SnapshotRequest` | `{ up_to_op_id: u64, shallow_start_op_id: u64 }` | Server asks a connected client to produce a snapshot. `up_to_op_id` = state frontier to encode at (= the producer's `last_acked_op_id`); `shallow_start_op_id` = where the snapshot's retained history starts (= horizon). |
| `Snapshot` | `{ up_to_op_id: u64, blob: EncryptedBlob }` | Response to `PullSnapshot`. `up_to_op_id` is the encoded state frontier; the bootstrapping client uses it as its next `since_op_id`. |
| `SnapshotRequired` | `{ up_to_op_id: u64 }` | Sent in lieu of `OpsBatch` when the client's `since_op_id` is below the latest snapshot's `shallow_start_op_id` (compaction floor — server can't serve the missing ops). Client must bootstrap from snapshot before resuming ops. `up_to_op_id` is informational; the authoritative state frontier is the one returned in `Snapshot`. |

`EncryptedBlob = { nonce: bytes, ciphertext: bytes }`.

## Ordering & ack flow

- Server orders ops by server-assigned `id` of arrival. Per-account FIFO.
- Client decrypts ops and applies via Loro; Loro handles real causal ordering.
- Client sends `Ack { last_acked_op_id }` after applying. Server stores in `devices.last_acked_op_id`.
- **Horizon** = `min(last_acked_op_id)` across all non-revoked devices for the account. Equivalent to the meet of all device VVs at that point — the server doesn't need to see Loro VVs because every device by definition has every op up to the horizon. Time-based eviction is deliberately *not* used to advance the horizon: a Loro shallow snapshot taken past a device's frontier produces ops the stale device can't merge back when it eventually reconnects (Loro rejects updates concurrent to the shallow start frontier; they sit in `ImportStatus.pending` forever). The user-facing escape hatch is explicit revoke via `DELETE /api/devices/:id` — revoking a stale device immediately drops it from the horizon calc, unblocking compaction.
- **`OpsBroadcast` is post-commit only.** Server fans out to other devices only after the originating `PushOps` is durable in storage. Otherwise a crash between broadcast and fsync could leave peers holding ops the sender will re-push (under new ids) on reconnect.

## Commit origin tagging

Every Loro commit carries an origin string. The engine uses two values:

- **`""`** (Loro default) — local mutations from the user. No explicit tag needed; `LoroDoc::commit()` already passes empty.
- **`"remote"`** — ops applied via `apply_remote()` after decrypting an inbound `OpsBatch`/`OpsBroadcast`. Set with `LoroDoc::import_with(bytes, "remote")`.

This exists so a future `UndoManager` can `exclude_origin_prefixes(["remote"])` and undo only the local user's edits, not concurrent remote ones. Origins are not synced; they're a local-only event filter (cf. Loro `set_next_commit_origin` docs). New non-local sources (snapshot bootstrap replay, schema migrations, etc.) get their own prefix as they appear — keep them disjoint from `"remote"` so undo policy can target them independently.

## Backpressure

`OpsBatch` chunks are sent **fire-and-forget** — the server emits them back-to-back without waiting for client acknowledgement. WebSocket sits on TCP, which has its own flow control: if the client can't drain its receive buffer fast enough (slow decrypt, low memory, paused tab), the TCP window closes and the server's `send` blocks. No application-level pacing required. This avoids paying RTT × chunk-count on catch-up — for a 10-chunk catch-up at 100 ms RTT, request-ack-request would burn 1 s of pure waiting; fire-and-forget burns 0.

The application-level `Ack { last_acked_op_id }` is **decoupled from chunk delivery**. It's emitted by the client *after* successfully applying ops to the local Loro doc, not on receipt of bytes. Server uses it only for horizon tracking; it does not gate further sends. This decoupling makes resume-after-disconnect correct: the client persists `last_acked_op_id` only after Loro accepts the op, so reconnecting with `since_op_id = last_acked_op_id` replays from the last *applied* op, not the last *delivered* one. No double-apply, no skipped ops.

The `complete: bool` on `OpsBatch` signals "no more chunks for this `PullOps`" — the client flushes its progress UI and considers the pull finished.

**Chunk size:** **500 ops or 256 KiB per `OpsBatch`, whichever hits first.** Sized to single-frame the common case (a session's worth of ops, or hours-away reconnect), give chunked progress UX for catch-up (thousands of ops → 5–10 frames), and stay well under WS frame caps that intermediaries enforce (~1 MiB at common proxies). The byte cap is a safety net against a future op type larger than expected.

## Snapshot orchestration

Snapshotting is **server-orchestrated, best-effort, and must never wedge sync**. It exists to bound bootstrap / compaction cost, not to gate normal operation.

A snapshot carries **two frontiers** (the two-frontier model maps directly onto Loro's shallow-snapshot primitive):

- **`up_to_op_id`** — the snapshot's encoded *state* frontier. Determines what current state a bootstrapping client sees, and the value the client uses as `since_op_id` for the post-bootstrap `PullOps`. Wants to be as recent as possible for bootstrap perf — ideally equal to the producer's `last_acked_op_id` (and hence equal to `server_last_op_id` when the producer is fully caught up).
- **`shallow_start_op_id`** — where the snapshot's retained history begins. Loro keeps every op between `shallow_start_op_id` and `up_to_op_id` individually addressable; ops below `shallow_start_op_id` are trimmed. **Must be ≤ horizon** so any device's offline-made commits (which causally depend on its `last_acked_op_id ≥ horizon`) remain mergeable on peers that bootstrap from this snapshot. Doubles as the **compaction floor**: ops with `id ≤ shallow_start_op_id` are deletable. Monotonic across snapshots — never regresses (see below).

Orchestration:

- Trigger: snapshot when **both**
  - `(latest_op_id − latest_snapshot.up_to_op_id) > snapshot_threshold_blobs` (default `10_000`, configurable via `snapshot_threshold_blobs` / `AIRDAY_SNAPSHOT_THRESHOLD_BLOBS`) — enough new state has accumulated that a new snapshot materially shortens a bootstrapping client's `PullOps` catch-up, and
  - the triggering device is caught up to `server_last_op_id` — that's what we set `up_to_op_id` to, so the producer must be at that point to encode it. Lagging connections are skipped as producers but still contribute to horizon.
  Counts blobs, not user actions or bytes — see §"Terminology" for why that matters.
  Horizon is intentionally **not** a trigger condition. Snapshotting is valuable for bootstrap perf independent of compaction — a single snapshot row replaces an arbitrarily long `OpsBatch` replay. If horizon hasn't moved, the new snapshot's `shallow_start_op_id` is the same as the previous one, so compaction doesn't advance — but the new snapshot still cuts bootstrap cost.
- `up_to_op_id` = the producer's `last_acked_op_id` = `server_last_op_id` (since the producer is caught up).
- `shallow_start_op_id` = `max(horizon, previous_snapshot.shallow_start_op_id)`. Normally just horizon; the `max` enforces monotonicity for the edge case where a fresh device's join drops horizon below the existing floor — compaction is one-way, so the floor stays put.
- Production: server sends `SnapshotRequest { up_to_op_id, shallow_start_op_id }`. Client serializes a Loro shallow snapshot — state at `up_to_op_id`, retained-history start at `shallow_start_op_id` — encrypts with DEK, uploads via `PushSnapshot { up_to_op_id, shallow_start_op_id, blob }`.
- Compaction: after a snapshot is durable, compaction may delete ops with `id ≤ snapshot.shallow_start_op_id`.

Server keeps **at most one in-flight snapshot request per account**:

- State:
  - `Idle`
  - `Requested { device_id, up_to_op_id, deadline }`
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
- The uploaded `up_to_op_id` must be **at least** the requested `up_to_op_id`, and `shallow_start_op_id` must equal the requested value (the server is asserting a specific compaction floor, not a range). Mismatched snapshots are ignored.
- A newer snapshot may replace an older one atomically once durable.

Operational notes:

- Keep the policy coarse. One candidate at a time, one deadline, one retry decision per failure is enough.
- Large accounts increase snapshot upload/download cost, but do **not** change the orchestration model.
- Server should log: request issued, request timed out, assignee disconnected, snapshot accepted, snapshot ignored as stale/mismatched, and retry abandoned for lack of candidates.

## Bootstrap from snapshot

A device whose `since_op_id` is below the latest snapshot's `shallow_start_op_id` cannot resume from ops alone — the ops it needs have been compacted. (Devices whose `since_op_id` is between `shallow_start_op_id` and `up_to_op_id` *can* still delta-pull, because those ops are preserved by horizon-bounded compaction.) On receiving a `PullOps` with `since_op_id < shallow_start_op_id`, the server replies `SnapshotRequired { up_to_op_id }` instead of `OpsBatch`. The client then:

1. `PullSnapshot` → server returns `Snapshot { up_to_op_id, blob }`.
2. Decrypt the blob and apply it to the local doc (Loro merges — local-only commits not yet pushed are preserved automatically; CRDT op-id reconciliation handles overlap with the device's own prior contributions).
3. `PullOps { since_op_id: up_to_op_id }` to catch up on any ops written after the snapshot was taken.

The `up_to_op_id` carried by `SnapshotRequired` is informational; the authoritative value is the one returned in the `Snapshot` frame, since the latest snapshot may advance between the two round trips.

`SnapshotRequired` and `Snapshot` are only valid in the bootstrap path. Up-to-date devices in steady state never receive either — `OpsBatch` / `OpsBroadcast` covers them. The `Snapshot` frame is therefore only accepted by a client in its bootstrap state, never mid-pull.

## Reconnect

Client maintains `last_acked_op_id` in local state. On reconnect: WS upgrade with token → `PullOps { since_op_id: last_acked_op_id }` → resume.

Exponential backoff 1s → 30s.
