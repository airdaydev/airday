//! Local-storage trait shared by every Airday client.
//!
//! The engine is sans-network but **not** sans-storage. On every commit
//! (local mutation or applied remote op) the engine appends an
//! encrypted row through this trait; on every server ack the engine
//! marks the matching row's `server_seq`; on boot the engine asks the
//! trait for the persisted snapshot + replay log so it can rebuild the
//! Loro doc and the cursor state.
//!
//! Two implementations satisfy the trait:
//!
//!   - `SqliteStorage` (CLI, future server-side single-account flows) —
//!     `rusqlite` against a file on disk. Writes are synchronously
//!     durable: the trait method returns only after the SQL `INSERT`
//!     commits.
//!   - `IdbStorage` (web) — IndexedDB on the main thread, behind a
//!     wasm-bindgen `extern` interface. Writes update an in-memory
//!     mirror synchronously (so the trait method can return a
//!     `LocalSeq` immediately) and the underlying IDB transaction
//!     flushes in the background. The engine learns about real
//!     durability via a separate callback so the server-side `Ack`
//!     frame isn't shipped until the bytes are actually on disk.
//!
//! Both impls live outside `core/`: native in `cli/src/storage.rs`,
//! web in `js/core/src/storage/idb-storage.ts` plus `core/web/src/lib.rs`.
//! `MemStorage` (this file) is the in-memory test double used by `core`
//! unit tests.
//!
//! See `spec/local-storage.md` for the schema, boot/replay semantics,
//! and the rationale (notably why web uses IDB rather than sqlite-wasm).

use airday_protocol::EncryptedBlob;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

// ---------- newtypes ----------

/// Server-assigned doc identifier. UUID v7 bytes; matches
/// `server/spec/storage.md`'s `docs.id`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DocId(pub Uuid);

/// Engine-minted per-op identifier. Unique within a device's lifetime;
/// the server doesn't see it. Used to match an `OpsAck`'s
/// server-assigned `server_seq` back to the local row that produced it
/// (see `ack_local_op`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ClientOpId(pub Uuid);

/// Storage-assigned monotonic id within a doc's `ops` log. Dense (no
/// gaps), strictly increasing per insert. Native impls source this from
/// the sqlite primary key; web mints it from an in-memory counter.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize,
)]
pub struct LocalSeq(pub u64);

/// Server-assigned per-account sequence number. Mirrors
/// `airday_protocol::StoredBlob::seq`. Dense within an account.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize,
)]
pub struct ServerSeq(pub u64);

// ---------- row types ----------

/// A locally-originated op, freshly committed and ready to ship. The
/// payload is the engine's sealed delta (encrypted with the DEK).
/// `server_seq` is filled later via `ack_local_op` once the server
/// acks. Timestamps come from the impl (sqlite `unixepoch()`, JS
/// `Date.now()`, MemStorage zero) — the engine is clock-free.
#[derive(Debug, Clone)]
pub struct LocalOpRow {
    pub client_op_id: ClientOpId,
    pub payload: EncryptedBlob,
}

/// An op that arrived from another device via the server. Already has
/// a `server_seq` (the server assigned it when the originating device
/// pushed); no `client_op_id` because we didn't mint it.
#[derive(Debug, Clone)]
pub struct RemoteOpRow {
    pub server_seq: ServerSeq,
    pub payload: EncryptedBlob,
}

/// One unacked local op: `(local_seq, client_op_id, payload)`, returned
/// by `outbox` in ascending `local_seq` order. Engine ships these in
/// the next `PushOps` frame; on the matching `OpsAck` it calls
/// `ack_local_op` for each `(client_op_id, server_seq)` pair.
#[derive(Debug, Clone)]
pub struct OutboxRow {
    pub local_seq: LocalSeq,
    pub client_op_id: ClientOpId,
    pub payload: EncryptedBlob,
}

/// One row of the persisted op log past the most recent snapshot, used
/// only on boot to replay the doc up to current state. Provenance
/// (local vs remote) is irrelevant for replay — both decrypt the same
/// way via the DEK.
#[derive(Debug, Clone)]
pub struct ReplayRow {
    pub local_seq: LocalSeq,
    pub payload: EncryptedBlob,
}

/// The persisted snapshot, if any. `up_to_local_seq` is the highest
/// local_seq whose effects are encoded in `payload` — any row in `ops`
/// with `local_seq > up_to_local_seq` is replayed on boot after
/// loading the snapshot.
#[derive(Debug, Clone)]
pub struct SnapshotRow {
    pub up_to_local_seq: LocalSeq,
    pub payload: EncryptedBlob,
}

/// Everything the engine needs at startup to reconstruct in-memory
/// state for one doc. Empty for a brand-new doc (`Default`).
#[derive(Debug, Clone, Default)]
pub struct BootState {
    /// Persisted snapshot, if one has been written.
    pub snapshot: Option<SnapshotRow>,
    /// Ops with `local_seq > snapshot.up_to_local_seq` (or all ops if
    /// `snapshot` is `None`), in ascending `local_seq` order. Engine
    /// decrypts each and feeds the plaintext through Loro.
    pub replay: Vec<ReplayRow>,
    /// Highest `local_seq` in the `ops` log. The next
    /// `append_local_op` / `append_remote_op` returns `LocalSeq(this + 1)`.
    pub last_local_seq: LocalSeq,
    /// Highest contiguous `server_seq` we've seen acked (own pushes
    /// included). Seeds `SyncEngine::last_contiguous_seq` /
    /// `last_durable_seq` — the `since_seq` of the resume `PullOps`.
    pub last_acked_server_seq: ServerSeq,
}

// ---------- errors ----------

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    /// Backend-specific failure (sqlite error, IDB transaction abort,
    /// JS exception across the wasm boundary). Stringified at the
    /// boundary so the trait stays portable.
    #[error("storage backend: {0}")]
    Backend(String),
    /// Caller asked for a doc the storage has never seen. Engine
    /// treats this as "fresh doc, empty BootState."
    #[error("doc not found: {0:?}")]
    DocNotFound(DocId),
    /// `ack_local_op` was called for a `client_op_id` that doesn't
    /// match any row in `ops`. Usually a bug, but the engine logs and
    /// continues — the server's view is authoritative.
    #[error("no local op with client_op_id {0:?}")]
    UnknownClientOpId(ClientOpId),
}

// ---------- trait ----------

/// Per-doc local persistence. Methods take `&self` so impls can use
/// interior mutability (sqlite `Mutex<Connection>`, JS handle held by
/// reference) — caller doesn't need `&mut`.
///
/// All methods are synchronous. Native impls are also synchronously
/// durable; the web impl returns from an in-memory mirror and flushes
/// IDB in the background (durability signalled out-of-band — see
/// `spec/local-storage.md`).
pub trait LocalStorage {
    /// Load everything the engine needs to bring a doc back to its
    /// last-persisted state. For a doc the storage has never seen,
    /// returns `Ok(BootState::default())` — not `Err(DocNotFound)` —
    /// so the first-boot path is a single happy path.
    fn boot(&self, doc_id: DocId) -> Result<BootState, StorageError>;

    /// Persist a locally-originated op. Returns the freshly-assigned
    /// `LocalSeq`. Engine calls this synchronously inside the
    /// mutation method (`add_item` and friends).
    fn append_local_op(&self, doc_id: DocId, row: LocalOpRow) -> Result<LocalSeq, StorageError>;

    /// Persist an op that arrived from another device. Returns the
    /// freshly-assigned `LocalSeq`. Engine calls this from
    /// `apply_remote_ops` after Loro has accepted the bytes.
    fn append_remote_op(&self, doc_id: DocId, row: RemoteOpRow) -> Result<LocalSeq, StorageError>;

    /// Stamp a previously-appended local row with the server-assigned
    /// `server_seq`. Removes the row from the next `outbox()` result.
    fn ack_local_op(
        &self,
        doc_id: DocId,
        client_op_id: ClientOpId,
        server_seq: ServerSeq,
    ) -> Result<(), StorageError>;

    /// Unacked local ops in ascending `local_seq` order. Engine calls
    /// this on reconnect (and after any mutation) to find ops to ship
    /// in the next `PushOps`.
    fn outbox(&self, doc_id: DocId) -> Result<Vec<OutboxRow>, StorageError>;

    /// Replace the snapshot row for this doc. Atomically advances the
    /// boot starting point past `up_to_local_seq`; impls may
    /// opportunistically prune `ops` rows with
    /// `local_seq <= up_to_local_seq` (compaction policy is per-impl
    /// and out of scope for the trait).
    fn write_snapshot(
        &self,
        doc_id: DocId,
        up_to_local_seq: LocalSeq,
        payload: EncryptedBlob,
    ) -> Result<(), StorageError>;

    /// Persist the resume cursor: the highest *contiguous* `server_seq`
    /// the engine has durably applied. The engine calls this from
    /// `notify_wal_durable` whenever the durable frontier advances, and
    /// impls must return this exact value as `BootState::last_acked_server_seq`
    /// next boot.
    ///
    /// This is set **explicitly**, never derived from
    /// `MAX(ops.server_seq)`: that derivation underestimates once
    /// compaction prunes the acked ops, and over-estimates past a gap
    /// (an out-of-order op above a hole must not advance the cursor).
    /// The engine is the sole authority for the value — impls just store
    /// the last one handed to them.
    fn write_acked_seq(&self, doc_id: DocId, seq: ServerSeq) -> Result<(), StorageError>;
}

/// Lets tests share one MemStorage between the engine (via
/// `Box<Arc<MemStorage>>`) and the test body (via the original `Arc`)
/// without inventing a per-storage adapter type. Production impls
/// don't need this — they're constructed once and owned by the engine.
impl<T: LocalStorage + ?Sized> LocalStorage for Arc<T> {
    fn boot(&self, doc_id: DocId) -> Result<BootState, StorageError> {
        (**self).boot(doc_id)
    }
    fn append_local_op(&self, doc_id: DocId, row: LocalOpRow) -> Result<LocalSeq, StorageError> {
        (**self).append_local_op(doc_id, row)
    }
    fn append_remote_op(&self, doc_id: DocId, row: RemoteOpRow) -> Result<LocalSeq, StorageError> {
        (**self).append_remote_op(doc_id, row)
    }
    fn ack_local_op(
        &self,
        doc_id: DocId,
        client_op_id: ClientOpId,
        server_seq: ServerSeq,
    ) -> Result<(), StorageError> {
        (**self).ack_local_op(doc_id, client_op_id, server_seq)
    }
    fn outbox(&self, doc_id: DocId) -> Result<Vec<OutboxRow>, StorageError> {
        (**self).outbox(doc_id)
    }
    fn write_snapshot(
        &self,
        doc_id: DocId,
        up_to_local_seq: LocalSeq,
        payload: EncryptedBlob,
    ) -> Result<(), StorageError> {
        (**self).write_snapshot(doc_id, up_to_local_seq, payload)
    }
    fn write_acked_seq(&self, doc_id: DocId, seq: ServerSeq) -> Result<(), StorageError> {
        (**self).write_acked_seq(doc_id, seq)
    }
}

// ---------- in-memory impl ----------

/// In-memory `LocalStorage` for `core` unit tests. Single doc per
/// instance is fine — tests construct a fresh `MemStorage` per case.
/// Not durable, not crash-safe, not for production use.
#[derive(Debug, Default)]
pub struct MemStorage {
    inner: Mutex<MemInner>,
}

#[derive(Debug, Default)]
struct MemInner {
    next_local_seq: u64,
    snapshot: Option<SnapshotRow>,
    /// All ops past the most recent snapshot, in insertion (==
    /// `local_seq`) order. Each entry carries the bookkeeping needed
    /// for `outbox` filtering.
    ops: Vec<MemOpRow>,
    last_acked_server_seq: u64,
}

#[derive(Debug, Clone)]
struct MemOpRow {
    local_seq: LocalSeq,
    /// `Some` for local-origin rows; `None` for remote-origin.
    client_op_id: Option<ClientOpId>,
    /// `Some` once the server has acked (set on `ack_local_op` for
    /// local rows; set at insert time for remote rows).
    server_seq: Option<ServerSeq>,
    payload: EncryptedBlob,
}

impl MemStorage {
    pub fn new() -> Self {
        Self::default()
    }
}

impl LocalStorage for MemStorage {
    fn boot(&self, _doc_id: DocId) -> Result<BootState, StorageError> {
        let inner = self.inner.lock().expect("MemStorage mutex poisoned");
        Ok(BootState {
            snapshot: inner.snapshot.clone(),
            replay: inner
                .ops
                .iter()
                .map(|r| ReplayRow {
                    local_seq: r.local_seq,
                    payload: r.payload.clone(),
                })
                .collect(),
            last_local_seq: LocalSeq(inner.next_local_seq),
            last_acked_server_seq: ServerSeq(inner.last_acked_server_seq),
        })
    }

    fn append_local_op(&self, _doc_id: DocId, row: LocalOpRow) -> Result<LocalSeq, StorageError> {
        let mut inner = self.inner.lock().expect("MemStorage mutex poisoned");
        inner.next_local_seq += 1;
        let local_seq = LocalSeq(inner.next_local_seq);
        inner.ops.push(MemOpRow {
            local_seq,
            client_op_id: Some(row.client_op_id),
            server_seq: None,
            payload: row.payload,
        });
        Ok(local_seq)
    }

    fn append_remote_op(&self, _doc_id: DocId, row: RemoteOpRow) -> Result<LocalSeq, StorageError> {
        let mut inner = self.inner.lock().expect("MemStorage mutex poisoned");
        inner.next_local_seq += 1;
        let local_seq = LocalSeq(inner.next_local_seq);
        // Appending an op does NOT advance the resume cursor — that's
        // `write_acked_seq`'s job (an out-of-order op above a gap would
        // wrongly jump it). Mirrors the real sqlite/IDB impls.
        inner.ops.push(MemOpRow {
            local_seq,
            client_op_id: None,
            server_seq: Some(row.server_seq),
            payload: row.payload,
        });
        Ok(local_seq)
    }

    fn ack_local_op(
        &self,
        _doc_id: DocId,
        client_op_id: ClientOpId,
        server_seq: ServerSeq,
    ) -> Result<(), StorageError> {
        let mut inner = self.inner.lock().expect("MemStorage mutex poisoned");
        let row = inner
            .ops
            .iter_mut()
            .find(|r| r.client_op_id == Some(client_op_id))
            .ok_or(StorageError::UnknownClientOpId(client_op_id))?;
        row.server_seq = Some(server_seq);
        // As in `append_remote_op`: stamping a server_seq doesn't move
        // the resume cursor — only `write_acked_seq` does.
        Ok(())
    }

    fn outbox(&self, _doc_id: DocId) -> Result<Vec<OutboxRow>, StorageError> {
        let inner = self.inner.lock().expect("MemStorage mutex poisoned");
        Ok(inner
            .ops
            .iter()
            .filter_map(|r| match (r.client_op_id, r.server_seq) {
                (Some(client_op_id), None) => Some(OutboxRow {
                    local_seq: r.local_seq,
                    client_op_id,
                    payload: r.payload.clone(),
                }),
                _ => None,
            })
            .collect())
    }

    fn write_snapshot(
        &self,
        _doc_id: DocId,
        up_to_local_seq: LocalSeq,
        payload: EncryptedBlob,
    ) -> Result<(), StorageError> {
        let mut inner = self.inner.lock().expect("MemStorage mutex poisoned");
        inner.snapshot = Some(SnapshotRow {
            up_to_local_seq,
            payload,
        });
        inner.ops.retain(|r| r.local_seq > up_to_local_seq);
        Ok(())
    }

    fn write_acked_seq(&self, _doc_id: DocId, seq: ServerSeq) -> Result<(), StorageError> {
        // Standalone field, independent of the `ops` vec — so it survives
        // `write_snapshot` pruning the rows it was derived from, the same
        // way the real impls persist a dedicated cursor column.
        let mut inner = self.inner.lock().expect("MemStorage mutex poisoned");
        inner.last_acked_server_seq = seq.0;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob(byte: u8) -> EncryptedBlob {
        EncryptedBlob {
            nonce: vec![byte; 12],
            ciphertext: vec![byte; 8],
        }
    }

    fn doc_id() -> DocId {
        DocId(Uuid::nil())
    }

    fn client_op_id(byte: u8) -> ClientOpId {
        let mut b = [0u8; 16];
        b[0] = byte;
        ClientOpId(Uuid::from_bytes(b))
    }

    #[test]
    fn empty_boot_state_for_fresh_storage() {
        let s = MemStorage::new();
        let boot = s.boot(doc_id()).unwrap();
        assert!(boot.snapshot.is_none());
        assert!(boot.replay.is_empty());
        assert_eq!(boot.last_local_seq, LocalSeq(0));
        assert_eq!(boot.last_acked_server_seq, ServerSeq(0));
    }

    #[test]
    fn append_local_op_assigns_monotonic_local_seqs() {
        let s = MemStorage::new();
        let s1 = s
            .append_local_op(
                doc_id(),
                LocalOpRow {
                    client_op_id: client_op_id(1),
                    payload: blob(1),
                },
            )
            .unwrap();
        let s2 = s
            .append_local_op(
                doc_id(),
                LocalOpRow {
                    client_op_id: client_op_id(2),
                    payload: blob(2),
                },
            )
            .unwrap();
        assert_eq!(s1, LocalSeq(1));
        assert_eq!(s2, LocalSeq(2));
    }

    #[test]
    fn outbox_returns_only_unacked_local_rows_in_order() {
        let s = MemStorage::new();
        for i in 1..=3u8 {
            s.append_local_op(
                doc_id(),
                LocalOpRow {
                    client_op_id: client_op_id(i),
                    payload: blob(i),
                },
            )
            .unwrap();
        }
        s.append_remote_op(
            doc_id(),
            RemoteOpRow {
                server_seq: ServerSeq(10),
                payload: blob(99),
            },
        )
        .unwrap();
        s.ack_local_op(doc_id(), client_op_id(2), ServerSeq(11))
            .unwrap();

        let outbox = s.outbox(doc_id()).unwrap();
        let ids: Vec<u8> = outbox
            .iter()
            .map(|r| r.client_op_id.0.as_bytes()[0])
            .collect();
        assert_eq!(ids, vec![1, 3]);
    }

    #[test]
    fn ack_unknown_client_op_id_errors() {
        let s = MemStorage::new();
        let err = s
            .ack_local_op(doc_id(), client_op_id(42), ServerSeq(1))
            .unwrap_err();
        assert!(matches!(err, StorageError::UnknownClientOpId(_)));
    }

    #[test]
    fn write_snapshot_prunes_replay_log() {
        let s = MemStorage::new();
        for i in 1..=3u8 {
            s.append_local_op(
                doc_id(),
                LocalOpRow {
                    client_op_id: client_op_id(i),
                    payload: blob(i),
                },
            )
            .unwrap();
        }
        s.write_snapshot(doc_id(), LocalSeq(2), blob(0xff)).unwrap();

        let boot = s.boot(doc_id()).unwrap();
        let snap = boot.snapshot.unwrap();
        assert_eq!(snap.up_to_local_seq, LocalSeq(2));
        assert_eq!(boot.replay.len(), 1);
        assert_eq!(boot.replay[0].local_seq, LocalSeq(3));
        // next_local_seq is preserved across snapshot — new ops continue
        // from where they left off.
        assert_eq!(boot.last_local_seq, LocalSeq(3));
    }
}
