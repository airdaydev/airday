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

/// Server-assigned blob id paired with the encrypted payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredBlob {
    pub blob_id: u64,
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
    /// Request all ops with id > since_blob_id. Streamed back as
    /// one or more `OpsBatch` frames; the last carries `complete=true`.
    PullOps { since_blob_id: u64 },
    /// Advance this device's frontier. Sent after Loro accepts the ops
    /// locally — never on raw byte receipt.
    Ack { last_acked_blob_id: u64 },
    /// Response to a `SnapshotRequest`. `up_to_blob_id` is the encoded
    /// state frontier; `shallow_start_blob_id` is where the snapshot's
    /// retained history starts (Loro shallow-snapshot boundary, doubles
    /// as the server's compaction floor for ops below it).
    PushSnapshot {
        up_to_blob_id: u64,
        shallow_start_blob_id: u64,
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
    OpsBatch {
        ops: Vec<StoredBlob>,
        complete: bool,
    },
    /// Pushed when another device on the same account commits ops.
    /// Reserved for the broadcast work.
    OpsBroadcast { ops: Vec<StoredBlob> },
    /// Server asks a connected, caught-up client to produce a snapshot.
    /// `up_to_blob_id` is the requested state frontier (= server's idea
    /// of the producer's `last_acked_blob_id`); `shallow_start_blob_id` is
    /// the retained-history boundary (= horizon). The client encodes a
    /// Loro shallow snapshot with these two frontiers.
    SnapshotRequest {
        up_to_blob_id: u64,
        shallow_start_blob_id: u64,
    },
    /// Response to `PullSnapshot`. `up_to_blob_id` is the snapshot's
    /// encoded state frontier; the bootstrapping client uses it as
    /// its next `since_blob_id` for `PullOps`.
    Snapshot {
        up_to_blob_id: u64,
        blob: EncryptedBlob,
    },
    /// Sent in lieu of `OpsBatch` when the client's `since_blob_id` is
    /// below the latest snapshot's `shallow_start_blob_id` — the ops it
    /// needs have been compacted, so it can't resume from ops alone.
    /// (Devices between `shallow_start_blob_id` and `up_to_blob_id` can
    /// still delta-pull — horizon-bounded compaction preserves those.)
    /// The client must `PullSnapshot`, apply the returned `Snapshot`,
    /// then re-issue `PullOps` from the snapshot's state frontier.
    /// `up_to_blob_id` here is informational; the authoritative value is
    /// the one in the `Snapshot` frame.
    SnapshotRequired { up_to_blob_id: u64 },
}
