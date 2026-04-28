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

## Snapshot orchestration

- Threshold: when `(latest_op_id − latest_snapshot.up_to_op_id) > 10_000`, server picks a candidate.
- Candidate = active device with highest `last_acked_op_id`.
- Server sends `SnapshotRequest`. Client serializes Loro shallow snapshot, encrypts with DEK, uploads via `PushSnapshot`.
- Timeout: if no `PushSnapshot` within e.g. 5 minutes, server picks next candidate.
- Server tracks at most one in-flight snapshot request per account.
- After snapshot is durable, compaction job may delete ops with `id ≤ min(horizon, snapshot.up_to_op_id)`.

## Active device definition

A device is active if `last_seen_at > now − 30 days`. Stale devices do not block the horizon.

A previously-stale device that reconnects with `last_acked_op_id < latest_snapshot.up_to_op_id` cannot resume from ops alone — it must `PullSnapshot` first, replace its local doc, then `PullOps` from `snapshot.up_to_op_id`.

## Reconnect

Client maintains `last_acked_op_id` in local state. On reconnect: WS upgrade with token → `PullOps { since_op_id: last_acked_op_id }` → resume.

Exponential backoff 1s → 30s.

## Open questions

- `OpsBatch` chunk size.
- Should `OpsBroadcast` to other devices wait for sender's storage commit? (Yes — broadcast post-commit only, otherwise a server crash before fsync could divulge ops the sender doesn't think are persisted.)
- WS frame size limits / backpressure for large initial pulls.
- How to express "this device is gone for good, drop it from horizon math without waiting 30 days" — explicit `DELETE /devices/:id`.
