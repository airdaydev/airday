# Sync Protocol

WebSocket per device. Frames are binary, MessagePack-encoded (`rmp-serde`). Each frame is a tagged enum (serde-internal-tag style) so the discriminator is part of the encoded value.

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
| `PushSnapshot` | `{ up_to_op_id: u64, blob: EncryptedBlob }` | In response to `SnapshotRequest`. |
| `PullSnapshot` | `{}` | Request the latest snapshot blob. |

## Server → Client

| Type | Body | Purpose |
|---|---|---|
| `OpsAck` | `{ assigned_ids: [u64] }` | Response to `PushOps`. |
| `OpsBatch` | `{ ops: [(u64, EncryptedBlob)], complete: bool }` | Response to `PullOps`; may chunk. |
| `OpsBroadcast` | `{ ops: [(u64, EncryptedBlob)] }` | Pushed when another device sends ops. |
| `SnapshotRequest` | `{ up_to_op_id: u64 }` | Server asks the most-acked active client to produce a snapshot. |
| `Snapshot` | `{ up_to_op_id: u64, blob: EncryptedBlob }` | Response to `PullSnapshot`. |

`EncryptedBlob = { nonce: bytes, ciphertext: bytes }`.

## Ordering & ack flow

- Server orders ops by server-assigned `id` of arrival. Per-account FIFO.
- Client decrypts ops and applies via Loro; Loro handles real causal ordering.
- Client sends `Ack { last_acked_op_id }` after applying. Server stores in `devices.last_acked_op_id`.
- **Horizon** = `min(last_acked_op_id)` across active devices. Equivalent to the meet of all device VVs at that point — the server doesn't need to see Loro VVs because every active device by definition has every op up to the horizon.
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

- Threshold: when `(latest_op_id − latest_snapshot.up_to_op_id) > 10_000`, server picks a candidate.
- Candidate = active device with highest `last_acked_op_id`.
- Server sends `SnapshotRequest`. Client serializes Loro shallow snapshot, encrypts with DEK, uploads via `PushSnapshot`.
- Timeout: if no `PushSnapshot` within e.g. 5 minutes, server picks next candidate.
- Server tracks at most one in-flight snapshot request per account.
- After snapshot is durable, compaction job may delete ops with `id ≤ min(horizon, snapshot.up_to_op_id)`.

## Active device definition

A device is active if `last_seen_at > now − 30 days`. Stale devices do not block the horizon. Explicit revoke via `DELETE /api/devices/:id` (see `auth.md`) drops the device immediately — no need to wait out the 30-day window.

A previously-stale device that reconnects with `last_acked_op_id < latest_snapshot.up_to_op_id` cannot resume from ops alone — it must `PullSnapshot` first, replace its local doc, then `PullOps` from `snapshot.up_to_op_id`.

## Reconnect

Client maintains `last_acked_op_id` in local state. On reconnect: WS upgrade with token → `PullOps { since_op_id: last_acked_op_id }` → resume.

Exponential backoff 1s → 30s.
