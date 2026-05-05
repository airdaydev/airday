//! Wire types for the WebSocket sync surface.
//!
//! Frames are MessagePack-encoded tagged enums (`#[serde(tag = "type")]`)
//! so the discriminator travels in-band — belt and braces against
//! someone wiring the wrong serializer to the wrong endpoint. The
//! protocol version is negotiated on connect via the `Hello` /
//! `HelloAck` exchange before any payload frame is exchanged.

use serde::{Deserialize, Serialize};

/// Current wire protocol version. Bump on breaking change; for purely
/// additive evolution rely on MessagePack's tagged-map semantics.
pub const PROTOCOL_VERSION: u32 = 1;

/// Encrypted op or snapshot payload. Server-side these are opaque
/// blobs — only the client (with the DEK) can decrypt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EncryptedBlob {
    #[serde(with = "serde_bytes")]
    pub nonce: Vec<u8>,
    #[serde(with = "serde_bytes")]
    pub ciphertext: Vec<u8>,
}

/// Server-assigned op id paired with the encrypted payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredOp {
    pub id: u64,
    pub blob: EncryptedBlob,
}

// ---------- handshake ----------

/// First frame on every WS connection (client → server).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hello {
    /// Free-form client identifier ("airday-cli", "airday-web", ...).
    pub client: String,
    pub client_version: String,
    /// Versions the client can speak. Server picks the highest shared.
    pub supported_protocol_versions: Vec<u32>,
}

/// Server's positive response to `Hello`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloAck {
    pub server_version: String,
    pub protocol_version: u32,
}

/// Server's negative response to `Hello`. Connection closes after.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloRejected {
    pub reason: String,
}

// ---------- client → server frames ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientFrame {
    /// Append ops. Server assigns monotonic ids and replies `OpsAck`.
    PushOps { ops: Vec<EncryptedBlob> },
    /// Request all ops with id > since_op_id. Streamed back as
    /// one or more `OpsBatch` frames; the last carries `complete=true`.
    PullOps { since_op_id: u64 },
    /// Advance this device's frontier. Sent after Loro accepts the ops
    /// locally — never on raw byte receipt.
    Ack { last_acked_op_id: u64 },
    /// Response to a `SnapshotRequest`. Reserved for the snapshot work.
    PushSnapshot {
        up_to_op_id: u64,
        blob: EncryptedBlob,
    },
    /// Request the latest snapshot blob. Reserved for the snapshot work.
    PullSnapshot,
}

// ---------- server → client frames ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerFrame {
    /// Response to `PushOps`. `assigned_ids[i]` corresponds to `ops[i]`
    /// from the request, in order.
    OpsAck { assigned_ids: Vec<u64> },
    /// Chunk of pulled ops. May be one of several frames per `PullOps`.
    OpsBatch { ops: Vec<StoredOp>, complete: bool },
    /// Pushed when another device on the same account commits ops.
    /// Reserved for the broadcast work.
    OpsBroadcast { ops: Vec<StoredOp> },
    /// Server asks the most-acked active client to produce a snapshot.
    /// Reserved for the snapshot work.
    SnapshotRequest { up_to_op_id: u64 },
    /// Response to `PullSnapshot`. Reserved for the snapshot work.
    Snapshot {
        up_to_op_id: u64,
        blob: EncryptedBlob,
    },
    /// Sent in lieu of `OpsBatch` when the client's `since_op_id` is
    /// below the latest snapshot's `up_to_op_id` — the device cannot
    /// resume from ops alone (it would either be missing compacted ops
    /// or wastefully replay every op since 0). The client must
    /// `PullSnapshot`, apply the returned `Snapshot`, then re-issue
    /// `PullOps { since_op_id: up_to_op_id }`.
    SnapshotRequired { up_to_op_id: u64 },
}
