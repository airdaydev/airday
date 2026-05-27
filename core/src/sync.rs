//! Sans-IO sync engine: the protocol state machine in shared Rust.
//!
//! The engine owns no socket, no clock, no thread. The caller (CLI's
//! tokio adapter, the browser's `WebSocket`, mobile's `URLSession` /
//! OkHttp) feeds it transport events via `handle_*` and drains
//! ready-to-send frame bytes via `pop_outbox()` and engine events via
//! `pop_event()`.
//!
//! See `spec/architecture.md` for the client-boundary rationale. The
//! state diagram is reproduced below:
//!
//! ```text
//!                          flush w/ pending
//!   Disconnected           ┌───────────────┐
//!        │                 │               ▼
//!   handle_connected       │           Pushing ─── on OpsAck ──┐
//!        ▼                 │             │  ▲                   │
//!       Hello              │       mutated │  │ ack arrived,    │
//!        │                 │       mid-push│  │ ack arrived &   │
//!     HelloAck             │               ▼  │ nothing more    │
//!        ▼                 │       PushingDirty                 │
//!     Pulling ── complete ─▶ Idle ◀──────────────────────────── ┘
//! ```

use std::collections::VecDeque;

use airday_protocol::{
    ClientFrame, Hello, HelloAck, HelloRejected, ServerFrame, StoredBlob, PROTOCOL_VERSION,
};
use loro::VersionVector;
use serde::Serialize;

use crate::crypto::Dek;
use crate::doc::Doc;

/// Engine-emitted notification, drained via `pop_event()`. None of
/// these are fatal on their own — the caller decides whether to
/// disconnect on `Error`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// `online=true` after `handle_connected`; `false` after the engine
    /// transitions to `Disconnected` (caller-driven, rejected handshake,
    /// or fatal frame error).
    ConnStateChanged { online: bool },
    /// Initial pull (`PullOps` → terminal `OpsBatch{complete: true}`)
    /// finished. Catch-up done; from here on, broadcasts deliver peer
    /// ops live.
    PulledInitial,
    /// Our own `PushOps` was acked and `Doc::last_pushed_vv` advanced.
    Pushed,
    /// The contiguous-prefix seq the engine has applied advanced.
    /// Useful for callers persisting `last_acked_seq` between sessions.
    FrontierAdvanced { seq: u64 },
    /// Recoverable error — the caller may choose to disconnect or just
    /// log and continue. Fatal handshake errors come paired with a
    /// `ConnStateChanged { online: false }` so the caller knows the
    /// engine is already back to `Disconnected`.
    Error(String),
}

/// Identity advertised in the `Hello` frame. Set once at construction.
#[derive(Debug, Clone)]
pub struct EngineOptions {
    pub client_name: String,
    pub client_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConnState {
    Disconnected,
    Hello,
    Pulling,
    /// Snapshot bootstrap path: we've received `SnapshotRequired`,
    /// emitted `PullSnapshot`, and are waiting for the `Snapshot`
    /// frame. Cold path — only entered when the server has compacted
    /// past our cursor (or we're a fresh device after compaction).
    Bootstrapping,
    Idle,
    Pushing,
    PushingDirty,
}

pub struct SyncEngine {
    doc: Doc,
    dek: Dek,
    opts: EngineOptions,
    state: ConnState,
    /// Contiguous-prefix seq we've applied in memory. Advances
    /// synchronously inside `apply_remote_ops` / `OpsAck` / `Snapshot`.
    /// Under sqlite single-writer this equals the maximum seq seen;
    /// under Postgres + replicas it lags the max-seen until a reorder
    /// buffer fills the holes. **Not** the value we ack — the engine
    /// only ships an Ack for a seq the host has confirmed durable via
    /// `notify_wal_durable`.
    last_contiguous_seq: u64,
    /// Contiguous-prefix seq the host has confirmed locally durable
    /// (encrypted WAL row committed for the bytes covering this seq).
    /// `<= last_contiguous_seq`. This is the value the engine sends
    /// in `Ack { last_acked_seq }`, and the value callers persist
    /// between sessions as the resume cursor (`PullOps`'s
    /// `since_seq`). Advances only via `notify_wal_durable`; a crash
    /// before the host's durable-notify means the server learns we
    /// have a seq strictly later than the previous session's cursor
    /// only after we re-apply + re-durable on the next run.
    last_durable_seq: u64,
    /// Highest seq we've already shipped in an `Ack`. Lets us coalesce:
    /// queue an `Ack` only when `last_durable_seq` overtakes this.
    last_sent_ack: u64,
    /// VV captured at the moment of the in-flight `PushOps` export. On
    /// `OpsAck` we merge this into `Doc::last_pushed_vv`. Cleared on
    /// disconnect so a re-push after reconnect re-exports from the
    /// server's last-known frontier.
    in_flight_push_vv: Option<VersionVector>,
    outbox: VecDeque<Vec<u8>>,
    events: VecDeque<Event>,
}

impl SyncEngine {
    /// Build a fresh engine. `last_acked_seq` is the persisted
    /// durable-prefix from the previous session — used as `since_seq`
    /// in the initial pull and as the floor for `last_durable_seq`.
    pub fn new(doc: Doc, dek: Dek, last_acked_seq: u64, opts: EngineOptions) -> Self {
        Self {
            doc,
            dek,
            opts,
            state: ConnState::Disconnected,
            last_contiguous_seq: last_acked_seq,
            last_durable_seq: last_acked_seq,
            last_sent_ack: last_acked_seq,
            in_flight_push_vv: None,
            outbox: VecDeque::new(),
            events: VecDeque::new(),
        }
    }

    pub fn doc(&self) -> &Doc {
        &self.doc
    }

    pub fn doc_mut(&mut self) -> &mut Doc {
        &mut self.doc
    }

    /// Contiguous-prefix seq the engine has applied **in memory**.
    /// Use this for transport-layer decisions (the `since_seq` of a
    /// mid-session resume `PullOps`, snapshot eligibility) — NOT as
    /// the persisted resume cursor. The persisted cursor must be
    /// `last_durable_seq()` so a crash never resumes from a seq the
    /// local doc/WAL doesn't actually contain.
    pub fn last_contiguous_seq(&self) -> u64 {
        self.last_contiguous_seq
    }

    /// Contiguous-prefix seq the host has confirmed locally durable.
    /// This is the value the engine has shipped (or will ship) in
    /// `Ack` frames, and the value callers persist between sessions
    /// as the resume cursor.
    pub fn last_durable_seq(&self) -> u64 {
        self.last_durable_seq
    }

    /// Host signal: every byte the engine had advanced through up to
    /// `seq` is now durable in local storage (encrypted WAL row
    /// committed). Advances `last_durable_seq` — clamped to
    /// `last_contiguous_seq` and monotonic — and queues an `Ack` if
    /// that advance overtakes `last_sent_ack`. Caller must
    /// `pop_outbox()` afterwards to ship the queued frame.
    ///
    /// Callers should sample `last_contiguous_seq()` *synchronously*
    /// at the moment of the durability work (e.g. just before queueing
    /// the IDB `appendWal` promise) and pass that sample back here
    /// after the write commits — this binds the notify to bytes that
    /// were actually persisted, not to wherever the in-memory engine
    /// has run on to in the meantime.
    pub fn notify_wal_durable(&mut self, seq: u64) {
        let clamped = seq.min(self.last_contiguous_seq);
        if clamped > self.last_durable_seq {
            self.last_durable_seq = clamped;
            self.queue_ack_if_advanced();
        }
    }

    /// True if the engine is past `Disconnected` — caller can treat
    /// this as "socket should be open."
    pub fn is_online(&self) -> bool {
        !matches!(self.state, ConnState::Disconnected)
    }

    /// True iff the engine has finished initial pull and isn't pushing.
    /// Useful for tests; callers usually don't need it.
    pub fn is_idle(&self) -> bool {
        matches!(self.state, ConnState::Idle)
    }

    /// Drain the next frame to write to the wire. Returns `None` when
    /// the outbox is empty. Caller is responsible for pacing — usually
    /// "drain to empty after every `handle_*` call."
    pub fn pop_outbox(&mut self) -> Option<Vec<u8>> {
        self.outbox.pop_front()
    }

    /// Drain the next engine event. Returns `None` when the event queue
    /// is empty.
    pub fn pop_event(&mut self) -> Option<Event> {
        self.events.pop_front()
    }

    /// Drain the next domain-level change event from the underlying
    /// doc. Pair with `pop_event` — the engine emits protocol events
    /// (`ConnStateChanged`, `Pushed`, `FrontierAdvanced`, `Error`),
    /// the doc emits `AppEvent`s (item / list lifecycle).
    pub fn pop_app_event(&self) -> Option<crate::events::AppEvent> {
        self.doc.pop_event()
    }

    /// Caller has a usable socket. Engine sends `Hello`, transitions to
    /// `Hello` state, awaits the server's response.
    pub fn handle_connected(&mut self) {
        if !matches!(self.state, ConnState::Disconnected) {
            self.events.push_back(Event::Error(
                "handle_connected called while already connected".into(),
            ));
            return;
        }
        self.state = ConnState::Hello;
        self.events
            .push_back(Event::ConnStateChanged { online: true });
        let hello = Hello {
            client: self.opts.client_name.clone(),
            client_version: self.opts.client_version.clone(),
            supported_protocol_versions: vec![PROTOCOL_VERSION],
        };
        if let Err(e) = self.encode_into_outbox(&hello) {
            self.events
                .push_back(Event::Error(format!("encode Hello: {e}")));
            self.go_disconnected();
        }
    }

    /// Caller's socket dropped (clean close, network error, tab closed).
    /// Engine returns to `Disconnected`; outbox is cleared (those bytes
    /// will be re-derived on reconnect).
    pub fn handle_disconnected(&mut self) {
        if matches!(self.state, ConnState::Disconnected) {
            return;
        }
        self.go_disconnected();
    }

    /// Caller's per-state timeout fired. The engine only escalates the
    /// `Hello` case (handshake didn't complete); other states are the
    /// caller's policy. Idempotent in non-Hello states.
    pub fn handle_timeout(&mut self) {
        if matches!(self.state, ConnState::Hello) {
            self.events
                .push_back(Event::Error("handshake timed out".into()));
        }
    }

    /// One frame's worth of bytes from the server. Caller is
    /// responsible for the WebSocket framing; the engine only sees the
    /// payload of one binary frame at a time.
    pub fn handle_server_bytes(&mut self, bytes: &[u8]) {
        match self.state {
            ConnState::Disconnected => {
                self.events.push_back(Event::Error(
                    "received server bytes while disconnected".into(),
                ));
            }
            ConnState::Hello => self.handle_hello_response(bytes),
            ConnState::Pulling
            | ConnState::Bootstrapping
            | ConnState::Idle
            | ConnState::Pushing
            | ConnState::PushingDirty => self.handle_server_frame(bytes),
        }
    }

    /// Caller signal: "user committed local mutations." If we're idle
    /// and there's something to ship, push. Otherwise the engine
    /// re-checks on the next transition into `Idle`, so flushing during
    /// `Pulling` / `Hello` / `Disconnected` is safe and just queues the
    /// intent.
    pub fn flush(&mut self) {
        match self.state {
            ConnState::Idle => self.try_start_push(),
            ConnState::Pushing => self.state = ConnState::PushingDirty,
            ConnState::PushingDirty
            | ConnState::Pulling
            | ConnState::Bootstrapping
            | ConnState::Hello
            | ConnState::Disconnected => {
                // Nothing to send right now — the next Idle transition
                // self-checks `Doc::has_pending_ops`.
            }
        }
    }

    // ---------- internals ----------

    fn handle_hello_response(&mut self, bytes: &[u8]) {
        // Hello{Ack,Rejected} aren't part of the `ServerFrame` tagged
        // enum — the spec sends them as bare types pre-handshake. Try
        // both decoders against the same buffer.
        if let Ok(ack) = rmp_serde::from_slice::<HelloAck>(bytes) {
            if ack.protocol_version != PROTOCOL_VERSION {
                self.events.push_back(Event::Error(format!(
                    "server picked protocol {} but client speaks {PROTOCOL_VERSION}",
                    ack.protocol_version,
                )));
                self.go_disconnected();
                return;
            }
            self.state = ConnState::Pulling;
            let frame = ClientFrame::PullOps {
                since_seq: self.last_contiguous_seq,
            };
            if let Err(e) = self.encode_into_outbox(&frame) {
                self.events
                    .push_back(Event::Error(format!("encode PullOps: {e}")));
                self.go_disconnected();
            }
            return;
        }
        if let Ok(rej) = rmp_serde::from_slice::<HelloRejected>(bytes) {
            self.events
                .push_back(Event::Error(format!("handshake rejected: {}", rej.reason)));
            self.go_disconnected();
            return;
        }
        self.events.push_back(Event::Error(
            "first server frame was neither HelloAck nor HelloRejected".into(),
        ));
        self.go_disconnected();
    }

    fn handle_server_frame(&mut self, bytes: &[u8]) {
        let frame = match rmp_serde::from_slice::<ServerFrame>(bytes) {
            Ok(f) => f,
            Err(e) => {
                self.events
                    .push_back(Event::Error(format!("decode ServerFrame: {e}")));
                return;
            }
        };
        match frame {
            ServerFrame::OpsBatch { ops, complete } => {
                if matches!(self.state, ConnState::Bootstrapping) {
                    self.events.push_back(Event::Error(
                        "OpsBatch received during Bootstrapping".into(),
                    ));
                    return;
                }
                self.apply_remote_ops(ops);
                // Ack is gated on `notify_wal_durable` — the host
                // calls back once the encrypted WAL row covering these
                // ops is committed.
                if complete && matches!(self.state, ConnState::Pulling) {
                    self.state = ConnState::Idle;
                    self.events.push_back(Event::PulledInitial);
                    // If the user mutated during the pull, ship now.
                    self.try_start_push();
                }
            }
            ServerFrame::OpsBroadcast { ops } => {
                if matches!(self.state, ConnState::Bootstrapping) {
                    // Broadcasts during bootstrap would either re-fire
                    // AppEvents on next pull or land before the snapshot
                    // baseline. Drop them — the post-bootstrap PullOps
                    // re-delivers anything past `up_to_seq`.
                    return;
                }
                self.apply_remote_ops(ops);
                // Ack gated on host's `notify_wal_durable`.
            }
            ServerFrame::OpsAck { assigned_seqs } => {
                if !matches!(self.state, ConnState::Pushing | ConnState::PushingDirty) {
                    self.events.push_back(Event::Error(format!(
                        "OpsAck received in unexpected state {:?}",
                        self.state
                    )));
                    return;
                }
                if let Some(top) = assigned_seqs.iter().copied().max() {
                    if top > self.last_contiguous_seq {
                        self.last_contiguous_seq = top;
                        self.events.push_back(Event::FrontierAdvanced { seq: top });
                    }
                }
                if let Some(vv) = self.in_flight_push_vv.take() {
                    self.doc.mark_pushed_at(vv);
                }
                self.events.push_back(Event::Pushed);
                // Ack gated on `notify_wal_durable`. The local op's
                // bytes may or may not be on disk yet (the host's
                // appendChain runs alongside the wire push), so the
                // engine doesn't tell the server "I have seq N" until
                // the host confirms it.
                let was_dirty = matches!(self.state, ConnState::PushingDirty);
                self.state = ConnState::Idle;
                if was_dirty {
                    // Re-export with the new oplog state and ship the
                    // mutations made during the in-flight push.
                    self.try_start_push();
                }
            }
            ServerFrame::SnapshotRequired { up_to_seq: _ } => {
                if !matches!(self.state, ConnState::Pulling) {
                    self.events.push_back(Event::Error(format!(
                        "SnapshotRequired received in unexpected state {:?}",
                        self.state
                    )));
                    return;
                }
                // `up_to_seq` is informational — the authoritative
                // value is the one returned in the `Snapshot` frame.
                self.state = ConnState::Bootstrapping;
                let frame = ClientFrame::PullSnapshot;
                if let Err(e) = self.encode_into_outbox(&frame) {
                    self.events
                        .push_back(Event::Error(format!("encode PullSnapshot: {e}")));
                    self.go_disconnected();
                }
            }
            ServerFrame::Snapshot { up_to_seq, blob } => {
                if !matches!(self.state, ConnState::Bootstrapping) {
                    self.events.push_back(Event::Error(format!(
                        "Snapshot received in unexpected state {:?}",
                        self.state
                    )));
                    return;
                }
                if let Err(e) = self.doc.apply_remote(&self.dek, &blob) {
                    self.events
                        .push_back(Event::Error(format!("apply snapshot: {e}")));
                    self.go_disconnected();
                    return;
                }
                if up_to_seq > self.last_contiguous_seq {
                    self.last_contiguous_seq = up_to_seq;
                    self.events
                        .push_back(Event::FrontierAdvanced { seq: up_to_seq });
                }
                // Ack gated on `notify_wal_durable` — the host needs
                // to persist the snapshot (either by committing it
                // directly via `commitSnapshot` or by exporting +
                // appending the resulting delta) before we tell the
                // server we have `up_to_seq`.
                // Resume the catch-up: pull any ops written after the
                // snapshot was taken.
                self.state = ConnState::Pulling;
                let frame = ClientFrame::PullOps {
                    since_seq: self.last_contiguous_seq,
                };
                if let Err(e) = self.encode_into_outbox(&frame) {
                    self.events
                        .push_back(Event::Error(format!("encode PullOps: {e}")));
                    self.go_disconnected();
                }
            }
            ServerFrame::SnapshotRequest {
                up_to_seq: _,
                shallow_start_seq,
            } => {
                // Server picked us as the snapshot producer. We produce
                // at the doc's current frontier and tag with our true
                // `last_contiguous_seq`, which is ≥ the requested value
                // (server only asks caught-up producers). Producing in
                // any active state is fine — snapshots are state-of-doc,
                // not a state-machine transition.
                //
                // TODO: `snapshot_blob` currently produces a full Loro
                // snapshot, not a shallow one — `shallow_start_seq`
                // is echoed back verbatim so the server's bookkeeping
                // (compaction floor) is correct, but no history is
                // actually trimmed yet. Switch to
                // `ExportMode::shallow_snapshot(frontier)` when the
                // seq -> Loro frontier mapping is wired through.
                let blob = match self.doc.snapshot_blob(&self.dek) {
                    Ok(b) => b,
                    Err(e) => {
                        self.events
                            .push_back(Event::Error(format!("snapshot_blob: {e}")));
                        return;
                    }
                };
                let frame = ClientFrame::PushSnapshot {
                    up_to_seq: self.last_contiguous_seq,
                    shallow_start_seq,
                    blob,
                };
                if let Err(e) = self.encode_into_outbox(&frame) {
                    self.events
                        .push_back(Event::Error(format!("encode PushSnapshot: {e}")));
                }
            }
        }
    }

    fn apply_remote_ops(&mut self, ops: Vec<StoredBlob>) {
        if ops.is_empty() {
            return;
        }

        let top = ops
            .iter()
            .map(|op| op.seq)
            .max()
            .unwrap_or(self.last_contiguous_seq);
        if let Err(e) = self
            .doc
            .apply_remote_batch(&self.dek, ops.iter().map(|op| &op.blob))
        {
            let failed_seq = ops
                .iter()
                .find(|op| op.seq > self.last_contiguous_seq)
                .map(|op| op.seq)
                .unwrap_or(top);
            self.events
                .push_back(Event::Error(format!("apply remote blob {failed_seq}: {e}")));
            return;
        }

        if top > self.last_contiguous_seq {
            self.last_contiguous_seq = top;
            self.events.push_back(Event::FrontierAdvanced { seq: top });
        }
        // Domain-level deltas (`AppEvent`) flow through `Doc`'s own
        // queue — drained by the host alongside this protocol event
        // queue. The engine no longer fires a coarse "OpsApplied"
        // signal; consumers poll `Doc::pop_event` for granular
        // `ItemAdded` / `ItemTextChanged` / etc.
    }

    fn queue_ack_if_advanced(&mut self) {
        if self.last_durable_seq > self.last_sent_ack {
            let ack = ClientFrame::Ack {
                last_acked_seq: self.last_durable_seq,
            };
            if self.encode_into_outbox(&ack).is_ok() {
                self.last_sent_ack = self.last_durable_seq;
            }
        }
    }

    fn try_start_push(&mut self) {
        if !matches!(self.state, ConnState::Idle) {
            return;
        }
        // Snapshot the oplog VV *before* exporting so we can mark
        // exactly these ops as pushed on ack — even if the user
        // mutates the doc again before the ack lands.
        let pre_vv = self.doc.oplog_vv();
        let blob = match self.doc.pending_export(&self.dek) {
            Ok(Some(b)) => b,
            Ok(None) => return,
            Err(e) => {
                self.events
                    .push_back(Event::Error(format!("pending_export: {e}")));
                return;
            }
        };
        let frame = ClientFrame::PushOps { ops: vec![blob] };
        if let Err(e) = self.encode_into_outbox(&frame) {
            self.events
                .push_back(Event::Error(format!("encode PushOps: {e}")));
            return;
        }
        self.in_flight_push_vv = Some(pre_vv);
        self.state = ConnState::Pushing;
    }

    fn go_disconnected(&mut self) {
        self.state = ConnState::Disconnected;
        self.in_flight_push_vv = None;
        self.outbox.clear();
        self.events
            .push_back(Event::ConnStateChanged { online: false });
    }

    fn encode_into_outbox<T: Serialize>(
        &mut self,
        value: &T,
    ) -> Result<(), rmp_serde::encode::Error> {
        let bytes = rmp_serde::to_vec_named(value)?;
        self.outbox.push_back(bytes);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{Doc, LIST_MAIN};
    use airday_protocol::{EncryptedBlob, ServerFrame, StoredBlob};

    fn opts() -> EngineOptions {
        EngineOptions {
            client_name: "test".into(),
            client_version: "0.0.0".into(),
        }
    }

    /// Engine over a fresh doc. With no persisted seeded ops, a
    /// pull-complete on an untouched engine leaves it idle.
    fn fresh_engine() -> SyncEngine {
        SyncEngine::new(Doc::new().unwrap(), Dek::generate(), 0, opts())
    }

    /// Engine over a seed-but-marked-pushed doc — pull-complete leaves
    /// the engine cleanly Idle without queueing a seed push. Default
    /// for state-machine tests so each one isolates a single
    /// transition.
    fn fresh_engine_clean() -> SyncEngine {
        let mut doc = Doc::new().unwrap();
        doc.mark_pushed();
        SyncEngine::new(doc, Dek::generate(), 0, opts())
    }

    fn enc<T: Serialize>(value: &T) -> Vec<u8> {
        rmp_serde::to_vec_named(value).unwrap()
    }

    fn dec<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> T {
        rmp_serde::from_slice(bytes).unwrap()
    }

    fn drain_outbox(eng: &mut SyncEngine) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        while let Some(b) = eng.pop_outbox() {
            out.push(b);
        }
        out
    }

    fn drain_events(eng: &mut SyncEngine) -> Vec<Event> {
        let mut out = Vec::new();
        while let Some(e) = eng.pop_event() {
            out.push(e);
        }
        out
    }

    /// Push a `fresh_engine_clean` through `Disconnected → ... → Idle`
    /// with an empty initial pull. Caller's doc has nothing pending,
    /// so pull-complete leaves us cleanly Idle with no auto-push.
    fn drive_to_idle(eng: &mut SyncEngine) {
        eng.handle_connected();
        let _hello = eng.pop_outbox().expect("Hello");
        eng.handle_server_bytes(&enc(&HelloAck {
            server_version: "test".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let _pull = eng.pop_outbox().expect("PullOps");
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }));
        assert!(eng.is_idle(), "expected Idle after empty pull");
    }

    /// Encrypt a blob using a separate "remote" doc + matching DEK.
    /// Lets a test simulate "another device pushed these ops to the
    /// server" without standing up a real network.
    ///
    /// We export the *full* remote state (seed + mutation) rather than
    /// a delta — Loro tracks per-peer monotonic op counters and rejects
    /// imports whose first op skips counters the importer doesn't have,
    /// so a "delta from a marked-pushed point" can land in `pending`
    /// instead of `success` when applied cold.
    fn make_remote_blob(dek: &Dek, mutate: impl FnOnce(&mut Doc)) -> EncryptedBlob {
        let mut remote = Doc::new().unwrap();
        mutate(&mut remote);
        remote.pending_export(dek).unwrap().expect("blob")
    }

    #[test]
    fn happy_path_handshake_and_empty_pull() {
        let mut eng = fresh_engine_clean();
        eng.handle_connected();
        let hello: Hello = dec(&eng.pop_outbox().unwrap());
        assert_eq!(hello.supported_protocol_versions, vec![PROTOCOL_VERSION]);
        assert_eq!(hello.client, "test");
        assert!(matches!(
            drain_events(&mut eng).as_slice(),
            [Event::ConnStateChanged { online: true }]
        ));

        eng.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let pull: ClientFrame = dec(&eng.pop_outbox().unwrap());
        assert!(matches!(pull, ClientFrame::PullOps { since_seq: 0 }));

        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }));
        assert!(eng.is_idle());
        let events = drain_events(&mut eng);
        assert!(events.contains(&Event::PulledInitial));
        assert!(
            eng.pop_outbox().is_none(),
            "no follow-up frames on empty pull"
        );
    }

    #[test]
    fn pull_complete_on_fresh_doc_stays_idle() {
        // A fresh doc has no seeded persisted ops, so an empty initial
        // pull completes without queuing a follow-up push.
        let mut eng = fresh_engine();
        eng.handle_connected();
        let _hello = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let _pull = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }));
        assert!(
            eng.pop_outbox().is_none(),
            "no follow-up push for untouched fresh doc"
        );
        assert!(eng.is_idle());
    }

    #[test]
    fn hello_rejected_disconnects_with_error() {
        let mut eng = fresh_engine_clean();
        eng.handle_connected();
        let _hello = eng.pop_outbox().unwrap();
        let _ = drain_events(&mut eng);
        eng.handle_server_bytes(&enc(&HelloRejected {
            reason: "no overlap".into(),
        }));
        assert!(!eng.is_online());
        let events = drain_events(&mut eng);
        assert!(matches!(events[0], Event::Error(ref s) if s.contains("rejected")));
        assert!(matches!(
            events.last(),
            Some(Event::ConnStateChanged { online: false })
        ));
    }

    #[test]
    fn unknown_protocol_version_disconnects_with_error() {
        let mut eng = fresh_engine_clean();
        eng.handle_connected();
        let _ = eng.pop_outbox().unwrap();
        let _ = drain_events(&mut eng);
        eng.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: 9999,
        }));
        assert!(!eng.is_online());
        let events = drain_events(&mut eng);
        assert!(matches!(events[0], Event::Error(ref s) if s.contains("9999")));
    }

    #[test]
    fn handle_timeout_in_hello_emits_error_only() {
        let mut eng = fresh_engine_clean();
        eng.handle_timeout();
        assert!(
            drain_events(&mut eng).is_empty(),
            "no error in Disconnected"
        );

        eng.handle_connected();
        let _ = drain_events(&mut eng);
        let _ = drain_outbox(&mut eng);
        eng.handle_timeout();
        let evs = drain_events(&mut eng);
        assert!(matches!(evs.as_slice(), [Event::Error(ref s)] if s.contains("timed out")));

        // In Idle, timeout is a no-op.
        let mut eng2 = fresh_engine_clean();
        drive_to_idle(&mut eng2);
        let _ = drain_events(&mut eng2);
        eng2.handle_timeout();
        assert!(drain_events(&mut eng2).is_empty());
    }

    #[test]
    fn flush_in_idle_pushes_when_pending() {
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);
        let _ = drain_outbox(&mut eng);

        eng.doc_mut().add_item(LIST_MAIN, "thing").unwrap();
        eng.flush();
        let frame: ClientFrame = dec(&eng.pop_outbox().expect("PushOps"));
        let blob = match frame {
            ClientFrame::PushOps { ops } => {
                assert_eq!(ops.len(), 1);
                ops.into_iter().next().unwrap()
            }
            other => panic!("expected PushOps, got {other:?}"),
        };

        eng.handle_server_bytes(&enc(&ServerFrame::OpsAck {
            assigned_seqs: vec![1],
        }));
        assert!(eng.is_idle());
        let events = drain_events(&mut eng);
        assert!(events.contains(&Event::Pushed));
        assert!(events.contains(&Event::FrontierAdvanced { seq: 1 }));

        // Engine must NOT queue an Ack before the host confirms the
        // op's bytes are locally durable — even on our own OpsAck.
        assert!(
            eng.pop_outbox().is_none(),
            "Ack frame queued before notify_wal_durable",
        );

        // Host signals "WAL row covering seq 1 is on disk" → ack ships.
        eng.notify_wal_durable(1);
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack"));
        assert!(matches!(ack, ClientFrame::Ack { last_acked_seq: 1 }));

        // No double-push: doc has nothing new since the in-flight VV
        // we just marked as pushed.
        eng.flush();
        assert!(eng.pop_outbox().is_none(), "second flush is a no-op");
        // Sanity: the blob really was a non-empty payload.
        assert!(!blob.ciphertext.is_empty());
    }

    #[test]
    fn flush_in_idle_with_no_pending_is_noop() {
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_outbox(&mut eng);
        let _ = drain_events(&mut eng);
        // No mutations since drive_to_idle → nothing on the wire.
        eng.flush();
        assert!(eng.pop_outbox().is_none());
    }

    #[test]
    fn pushing_dirty_re_pushes_after_ack() {
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);

        // First mutation + flush starts a push.
        eng.doc_mut().add_item(LIST_MAIN, "first").unwrap();
        eng.flush();
        let _first_push = eng.pop_outbox().expect("first PushOps");

        // Mutate again while the push is in flight.
        let item_id = eng.doc_mut().add_item(LIST_MAIN, "during-push").unwrap();
        eng.flush();
        // No new wire bytes yet — engine is in PushingDirty, waiting.
        assert!(eng.pop_outbox().is_none());

        // Server acks the first push.
        eng.handle_server_bytes(&enc(&ServerFrame::OpsAck {
            assigned_seqs: vec![1],
        }));

        // Engine should immediately re-push with the mid-push mutation.
        let mut saw_repush = false;
        while let Some(bytes) = eng.pop_outbox() {
            if let Ok(ClientFrame::PushOps { ops }) = rmp_serde::from_slice::<ClientFrame>(&bytes) {
                assert_eq!(ops.len(), 1);
                saw_repush = true;
            }
        }
        assert!(saw_repush, "PushingDirty must re-push after ack");

        eng.handle_server_bytes(&enc(&ServerFrame::OpsAck {
            assigned_seqs: vec![2],
        }));
        assert!(eng.is_idle());
        // The mid-push mutation made it into the doc and the second
        // push acked it.
        assert!(eng.doc().get_item(&item_id).is_some());
    }

    #[test]
    fn flush_during_pull_pushes_when_pull_completes() {
        let mut eng = fresh_engine_clean();
        eng.handle_connected();
        let _ = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let _ = eng.pop_outbox().unwrap(); // PullOps

        // User mutates and flushes while we're still Pulling.
        eng.doc_mut().add_item(LIST_MAIN, "during pull").unwrap();
        eng.flush();
        assert!(eng.pop_outbox().is_none(), "Pulling defers push until Idle");

        // Pull completes — engine should self-trigger the push.
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }));
        let frame: ClientFrame = dec(&eng.pop_outbox().expect("PushOps after pull"));
        assert!(matches!(frame, ClientFrame::PushOps { .. }));
    }

    #[test]
    fn broadcast_during_idle_applies_and_acks() {
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);

        // Build a remote-origin blob, hand it to the engine via
        // OpsBroadcast with an assigned seq of 7.
        let remote_blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "from peer").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredBlob {
                seq: 7,
                blob: remote_blob,
            }],
        }));
        let events = drain_events(&mut eng);
        assert!(events.contains(&Event::FrontierAdvanced { seq: 7 }));
        // Granular AppEvent: the peer item shows up on the doc's queue.
        let app_evs: Vec<_> = std::iter::from_fn(|| eng.pop_app_event()).collect();
        assert!(
            app_evs
                .iter()
                .any(|e| matches!(e, crate::events::AppEvent::ItemAdded { text, .. } if text == "from peer")),
            "expected ItemAdded for `from peer` in {app_evs:?}"
        );
        assert_eq!(eng.last_contiguous_seq(), 7);
        assert_eq!(eng.last_durable_seq(), 0, "durable lags until notify");
        // No Ack until host confirms durability.
        assert!(
            eng.pop_outbox().is_none(),
            "Ack frame queued before notify_wal_durable",
        );
        eng.notify_wal_durable(7);
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack"));
        assert!(matches!(ack, ClientFrame::Ack { last_acked_seq: 7 }));

        // Local doc reflects the applied peer op.
        let names: Vec<_> = eng
            .doc()
            .items_in_list(LIST_MAIN, false)
            .into_iter()
            .map(|i| i.text)
            .collect();
        assert!(names.iter().any(|t| t == "from peer"));
    }

    #[test]
    fn ops_batch_applies_multiple_remote_ops_before_ack() {
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        let mut remote = Doc::new().unwrap();
        let id = remote.add_item(LIST_MAIN, "old").unwrap();
        let setup_blob = remote.pending_export(&dek).unwrap().unwrap();
        remote.mark_pushed();
        remote.edit_item_text(&id, "new").unwrap();
        let edit_blob = remote.pending_export(&dek).unwrap().unwrap();

        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);
        let _ = drain_outbox(&mut eng);

        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![
                StoredBlob {
                    seq: 7,
                    blob: setup_blob,
                },
                StoredBlob {
                    seq: 8,
                    blob: edit_blob,
                },
            ],
            complete: false,
        }));

        let events = drain_events(&mut eng);
        assert_eq!(events, vec![Event::FrontierAdvanced { seq: 8 }]);

        let app_evs: Vec<_> = std::iter::from_fn(|| eng.pop_app_event()).collect();
        assert!(
            app_evs.iter().any(|e| matches!(
                e,
                crate::events::AppEvent::ItemAdded { id: eid, text, .. } if eid == &id && text == "new"
            )),
            "expected final ItemAdded for {id} in {app_evs:?}"
        );
        assert!(
            !app_evs.iter().any(|e| matches!(
                e,
                crate::events::AppEvent::ItemTextChanged { id: eid, .. } if eid == &id
            )),
            "batch apply should not emit intermediate ItemTextChanged churn: {app_evs:?}"
        );

        // Ack gated on host-confirmed durability.
        assert!(eng.pop_outbox().is_none());
        eng.notify_wal_durable(8);
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack"));
        assert!(matches!(ack, ClientFrame::Ack { last_acked_seq: 8 }));
        assert_eq!(eng.last_contiguous_seq(), 8);
        assert_eq!(eng.last_durable_seq(), 8);
    }

    #[test]
    fn broadcast_during_pushing_does_not_clobber_in_flight() {
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);

        // Mutate locally, start a push.
        eng.doc_mut().add_item(LIST_MAIN, "local-pushing").unwrap();
        eng.flush();
        let _ = eng.pop_outbox().expect("PushOps");

        // Broadcast arrives during Pushing.
        let remote_blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "peer-during-push").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredBlob {
                seq: 5,
                blob: remote_blob,
            }],
        }));
        // State still Pushing — broadcast doesn't transition.
        assert!(!eng.is_idle());
        // Peer op applied.
        assert!(eng
            .doc()
            .items_in_list(LIST_MAIN, false)
            .iter()
            .any(|i| i.text == "peer-during-push"));

        // Server acks our push with seq 6.
        eng.handle_server_bytes(&enc(&ServerFrame::OpsAck {
            assigned_seqs: vec![6],
        }));
        assert!(eng.is_idle());
        // No Ack queued yet (gated on `notify_wal_durable`); drain
        // anyway in case future engine evolution adds post-ack
        // housekeeping here.
        let _ = drain_outbox(&mut eng);
        // Doc's last_pushed_vv now covers BOTH our local mutation and
        // the peer op — so a fresh flush has nothing new to ship.
        eng.flush();
        assert!(eng.pop_outbox().is_none(), "no re-push after broadcast+ack");
    }

    #[test]
    fn multi_batch_pull_reaches_idle_only_on_complete() {
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        eng.handle_connected();
        let _ = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let _ = eng.pop_outbox().unwrap();

        // First batch: not complete, engine stays Pulling.
        let blob1 = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "p1").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![StoredBlob {
                seq: 1,
                blob: blob1,
            }],
            complete: false,
        }));
        assert!(!eng.is_idle());
        let events = drain_events(&mut eng);
        assert!(!events.contains(&Event::PulledInitial));

        // Second batch: complete=true, transitions to Idle.
        let blob2 = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "p2").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![StoredBlob {
                seq: 2,
                blob: blob2,
            }],
            complete: true,
        }));
        assert!(eng.is_idle());
        let events = drain_events(&mut eng);
        assert!(events.contains(&Event::PulledInitial));
        assert_eq!(eng.last_contiguous_seq(), 2);
    }

    #[test]
    fn disconnect_from_pushing_clears_in_flight() {
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);
        eng.doc_mut().add_item(LIST_MAIN, "stranded").unwrap();
        eng.flush();
        let _ = eng.pop_outbox().unwrap();
        let _ = drain_events(&mut eng);

        eng.handle_disconnected();
        assert!(!eng.is_online());
        let events = drain_events(&mut eng);
        assert!(matches!(
            events.as_slice(),
            [Event::ConnStateChanged { online: false }]
        ));
        // Outbox drained; reconnect can re-derive frames.
        assert!(eng.pop_outbox().is_none());

        // Re-connect, run an empty pull. The doc still has pending ops
        // (the first push never landed) so the engine auto-pushes on
        // pull-complete.
        eng.handle_connected();
        let _ = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let _ = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }));
        let frame: ClientFrame = dec(&eng.pop_outbox().expect("re-push after reconnect"));
        assert!(matches!(frame, ClientFrame::PushOps { .. }));
    }

    #[test]
    fn server_bytes_while_disconnected_is_an_error() {
        let mut eng = fresh_engine_clean();
        eng.handle_server_bytes(b"\x00\x01");
        let evs = drain_events(&mut eng);
        assert!(matches!(evs.as_slice(), [Event::Error(_)]));
    }

    #[test]
    fn handle_connected_twice_emits_error() {
        let mut eng = fresh_engine_clean();
        eng.handle_connected();
        let _ = drain_events(&mut eng);
        eng.handle_connected();
        let evs = drain_events(&mut eng);
        assert!(matches!(evs.as_slice(), [Event::Error(_)]));
    }

    #[test]
    fn opsack_outside_pushing_emits_error() {
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);
        eng.handle_server_bytes(&enc(&ServerFrame::OpsAck {
            assigned_seqs: vec![42],
        }));
        let evs = drain_events(&mut eng);
        assert!(matches!(evs.as_slice(), [Event::Error(ref s)] if s.contains("OpsAck")));
    }

    #[test]
    fn since_seq_carries_persisted_frontier() {
        let mut doc = Doc::new().unwrap();
        doc.mark_pushed();
        let mut eng = SyncEngine::new(doc, Dek::generate(), 42, opts());
        eng.handle_connected();
        let _hello = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let pull: ClientFrame = dec(&eng.pop_outbox().unwrap());
        assert!(matches!(pull, ClientFrame::PullOps { since_seq: 42 }));
    }

    #[test]
    fn snapshot_request_produces_pushsnapshot_with_current_frontier() {
        // Server picks us as snapshot producer. We tag with our true
        // `last_contiguous_seq` (≥ requested up_to_seq), and the blob
        // must round-trip through `apply_remote` into a peer doc to
        // the same logical state — that's the property that makes the
        // snapshot useful for bootstrap.
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);
        let _ = drain_outbox(&mut eng);

        // Make our doc non-trivial and bump our frontier above the
        // requested value so the tag-with-true-frontier behavior is
        // visible.
        eng.doc_mut().add_item(LIST_MAIN, "alpha").unwrap();
        eng.doc_mut().add_item(LIST_MAIN, "beta").unwrap();
        // Simulate our last server-acked frontier sitting at 50.
        // (We can't easily mutate via public API; mimic via a
        // broadcast that advances `last_contiguous_seq` to 50.)
        let dek = eng.dek.clone();
        let bump_blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "from-peer").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredBlob {
                seq: 50,
                blob: bump_blob,
            }],
        }));
        let _ = drain_outbox(&mut eng); // drop the auto-Ack

        // Server requests a snapshot up to 30 (below our current 50)
        // with shallow_start at 20.
        eng.handle_server_bytes(&enc(&ServerFrame::SnapshotRequest {
            up_to_seq: 30,
            shallow_start_seq: 20,
        }));
        let push: ClientFrame = dec(&eng.pop_outbox().expect("PushSnapshot"));
        let (tagged_up_to, tagged_shallow, blob) = match push {
            ClientFrame::PushSnapshot {
                up_to_seq,
                shallow_start_seq,
                blob,
            } => (up_to_seq, shallow_start_seq, blob),
            other => panic!("expected PushSnapshot, got {other:?}"),
        };
        // Tagged with our actual frontier, not the requested value.
        assert_eq!(tagged_up_to, 50);
        // Shallow start echoes the server's requested value verbatim.
        assert_eq!(tagged_shallow, 20);

        // Round-trip: apply the blob to a peer doc and verify
        // fingerprints match — the producer/consumer round trip
        // converges to identical logical state.
        let mut peer = Doc::empty();
        peer.apply_remote(&dek, &blob).unwrap();
        assert_eq!(peer.fingerprint(), eng.doc().fingerprint());
    }

    #[test]
    fn unsolicited_snapshot_in_idle_is_an_error() {
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);
        eng.handle_server_bytes(&enc(&ServerFrame::Snapshot {
            up_to_seq: 99,
            blob: EncryptedBlob {
                nonce: vec![0; 24],
                ciphertext: vec![],
            },
        }));
        let evs = drain_events(&mut eng);
        assert!(matches!(evs.as_slice(), [Event::Error(ref s)] if s.contains("Snapshot")));
    }

    #[test]
    fn snapshot_required_in_pulling_drives_bootstrap() {
        // Wire:  HelloAck -> PullOps(since=0) -> SnapshotRequired
        //   ->   PullSnapshot -> Snapshot -> PullOps(since=up_to)
        //   ->   OpsBatch{complete} -> Idle
        let dek = Dek::generate();
        let mut eng = SyncEngine::new(Doc::empty(), dek.clone(), 0, opts());
        eng.handle_connected();
        let _ = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let _ = eng.pop_outbox().unwrap(); // PullOps

        // Server says cursor is below the floor.
        eng.handle_server_bytes(&enc(&ServerFrame::SnapshotRequired { up_to_seq: 42 }));
        let pull_snap: ClientFrame = dec(&eng.pop_outbox().expect("PullSnapshot"));
        assert!(matches!(pull_snap, ClientFrame::PullSnapshot));
        // Engine is now in Bootstrapping (not idle, not pulling).
        assert!(!eng.is_idle());

        // Build a snapshot blob from a parallel doc — same DEK, with a
        // peer item we expect to land in the bootstrapped state.
        let snapshot_blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "from-snapshot").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::Snapshot {
            up_to_seq: 42,
            blob: snapshot_blob,
        }));

        // Engine should have advanced its frontier and re-issued
        // PullOps. The Ack waits for the host to confirm the
        // bootstrap snapshot is locally durable.
        assert_eq!(eng.last_contiguous_seq(), 42);
        assert_eq!(eng.last_durable_seq(), 0);
        let mut frames: Vec<ClientFrame> = Vec::new();
        while let Some(b) = eng.pop_outbox() {
            frames.push(dec(&b));
        }
        assert!(
            !frames.iter().any(|f| matches!(f, ClientFrame::Ack { .. })),
            "Ack queued before notify_wal_durable: {frames:?}",
        );
        assert!(frames
            .iter()
            .any(|f| matches!(f, ClientFrame::PullOps { since_seq: 42 })));

        // Host commits the snapshot → ack ships.
        eng.notify_wal_durable(42);
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack"));
        assert!(matches!(ack, ClientFrame::Ack { last_acked_seq: 42 }));

        // Bootstrapped item is in the doc.
        assert!(eng
            .doc()
            .items_in_list(LIST_MAIN, false)
            .iter()
            .any(|i| i.text == "from-snapshot"));

        // Finish the catch-up pull.
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }));
        assert!(eng.is_idle());
    }

    #[test]
    fn opsbroadcast_during_bootstrap_is_dropped() {
        let dek = Dek::generate();
        let mut eng = SyncEngine::new(Doc::empty(), dek.clone(), 0, opts());
        eng.handle_connected();
        let _ = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let _ = eng.pop_outbox().unwrap(); // PullOps
        eng.handle_server_bytes(&enc(&ServerFrame::SnapshotRequired { up_to_seq: 10 }));
        let _ = eng.pop_outbox().unwrap(); // PullSnapshot

        // Broadcast while bootstrapping — must be ignored entirely.
        let stray = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "should-not-appear").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredBlob {
                seq: 11,
                blob: stray,
            }],
        }));
        assert!(
            !eng.doc()
                .items_in_list(LIST_MAIN, false)
                .iter()
                .any(|i| i.text == "should-not-appear"),
            "broadcast applied during Bootstrapping",
        );
        assert_eq!(eng.last_contiguous_seq(), 0, "frontier must not advance");
    }

    #[test]
    fn produce_then_bootstrap_round_trip() {
        // Full producer/consumer loop with a fake server in between:
        //   A pushes ops; server stores them.
        //   Server asks A for a snapshot; A produces PushSnapshot.
        //   B (fresh) connects with since=0; below the snapshot
        //   floor, so server replies SnapshotRequired -> Snapshot.
        //   B applies, pulls past-the-snapshot ops, reaches Idle.
        //   Fingerprints converge.
        let dek = Dek::generate();
        let mut a = SyncEngine::new(Doc::new().unwrap(), dek.clone(), 0, opts());
        let mut b = {
            let mut doc = Doc::empty();
            doc.mark_pushed();
            SyncEngine::new(doc, dek.clone(), 0, opts())
        };

        // Fake server state.
        let mut next_seq: u64 = 0;
        let mut ops_log: Vec<StoredBlob> = Vec::new();

        // -- A connects, pushes its seed --
        a.handle_connected();
        let _ = a.pop_outbox().unwrap();
        a.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let _ = a.pop_outbox().unwrap();
        a.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }));
        // Drain A's seed push and any subsequent pushes; ack each.
        while let Some(bytes) = a.pop_outbox() {
            if let Ok(ClientFrame::PushOps { ops }) = rmp_serde::from_slice::<ClientFrame>(&bytes) {
                let assigned: Vec<u64> = ops
                    .into_iter()
                    .map(|blob| {
                        next_seq += 1;
                        ops_log.push(StoredBlob {
                            seq: next_seq,
                            blob,
                        });
                        next_seq
                    })
                    .collect();
                a.handle_server_bytes(&enc(&ServerFrame::OpsAck {
                    assigned_seqs: assigned,
                }));
            }
        }

        // -- A makes a real-content change --
        let item_id = a.doc_mut().add_item(LIST_MAIN, "snapshotted").unwrap();
        a.flush();
        if let Some(bytes) = a.pop_outbox() {
            if let Ok(ClientFrame::PushOps { ops }) = rmp_serde::from_slice::<ClientFrame>(&bytes) {
                let assigned: Vec<u64> = ops
                    .into_iter()
                    .map(|blob| {
                        next_seq += 1;
                        ops_log.push(StoredBlob {
                            seq: next_seq,
                            blob,
                        });
                        next_seq
                    })
                    .collect();
                a.handle_server_bytes(&enc(&ServerFrame::OpsAck {
                    assigned_seqs: assigned,
                }));
            }
        }
        let _ = drain_outbox(&mut a);
        assert_eq!(a.last_contiguous_seq(), next_seq);

        // -- Server requests a snapshot from A. Single-device account,
        //    so horizon == next_seq; shallow_start equals up_to. --
        a.handle_server_bytes(&enc(&ServerFrame::SnapshotRequest {
            up_to_seq: next_seq,
            shallow_start_seq: next_seq,
        }));
        let push: ClientFrame = dec(&a.pop_outbox().expect("PushSnapshot"));
        let (snapshot_up_to, snapshot_shallow, snapshot_blob) = match push {
            ClientFrame::PushSnapshot {
                up_to_seq,
                shallow_start_seq,
                blob,
            } => (up_to_seq, shallow_start_seq, blob),
            other => panic!("expected PushSnapshot, got {other:?}"),
        };
        assert_eq!(snapshot_up_to, next_seq);
        assert_eq!(snapshot_shallow, next_seq);

        // -- A keeps mutating after the snapshot was taken, so B's
        //    bootstrap exercises both the snapshot apply *and* the
        //    post-snapshot catch-up via OpsBatch. --
        let post_snap_id = a.doc_mut().add_item(LIST_MAIN, "post-snap").unwrap();
        a.flush();
        let mut post_snap_ops: Vec<StoredBlob> = Vec::new();
        if let Some(bytes) = a.pop_outbox() {
            if let Ok(ClientFrame::PushOps { ops }) = rmp_serde::from_slice::<ClientFrame>(&bytes) {
                let mut assigned = Vec::new();
                for blob in ops {
                    next_seq += 1;
                    post_snap_ops.push(StoredBlob {
                        seq: next_seq,
                        blob: blob.clone(),
                    });
                    ops_log.push(StoredBlob {
                        seq: next_seq,
                        blob,
                    });
                    assigned.push(next_seq);
                }
                a.handle_server_bytes(&enc(&ServerFrame::OpsAck {
                    assigned_seqs: assigned,
                }));
            }
        }
        let _ = drain_outbox(&mut a);
        assert!(
            !post_snap_ops.is_empty(),
            "expected at least one post-snapshot op"
        );

        // -- B connects fresh, since=0 < snapshot floor --
        b.handle_connected();
        let _ = b.pop_outbox().unwrap();
        b.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let pull: ClientFrame = dec(&b.pop_outbox().unwrap());
        assert!(matches!(pull, ClientFrame::PullOps { since_seq: 0 }));

        // Fake server: since (0) < snapshot.up_to_seq, reply SnapshotRequired.
        b.handle_server_bytes(&enc(&ServerFrame::SnapshotRequired {
            up_to_seq: snapshot_up_to,
        }));
        let pull_snap: ClientFrame = dec(&b.pop_outbox().expect("PullSnapshot"));
        assert!(matches!(pull_snap, ClientFrame::PullSnapshot));

        // Fake server: hand back the stored snapshot.
        b.handle_server_bytes(&enc(&ServerFrame::Snapshot {
            up_to_seq: snapshot_up_to,
            blob: snapshot_blob,
        }));

        // B should re-issue PullOps from the snapshot's up_to.
        let mut saw_resume_pull = false;
        while let Some(bytes) = b.pop_outbox() {
            if let Ok(frame) = rmp_serde::from_slice::<ClientFrame>(&bytes) {
                if matches!(frame, ClientFrame::PullOps { since_seq } if since_seq == snapshot_up_to)
                {
                    saw_resume_pull = true;
                }
            }
        }
        assert!(saw_resume_pull, "B must PullOps from snapshot.up_to");

        // Catch-up batch carries the post-snapshot op that A pushed
        // after the snapshot was taken.
        b.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: post_snap_ops,
            complete: true,
        }));
        assert!(b.is_idle());

        // Both pre-snapshot and post-snapshot items land on B.
        assert!(
            b.doc().get_item(&item_id).is_some(),
            "snapshot item missing"
        );
        assert!(
            b.doc().get_item(&post_snap_id).is_some(),
            "post-snapshot item missing",
        );
        assert_eq!(a.doc().fingerprint(), b.doc().fingerprint());
    }

    #[test]
    fn snapshot_required_outside_pulling_is_an_error() {
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);
        eng.handle_server_bytes(&enc(&ServerFrame::SnapshotRequired { up_to_seq: 1 }));
        let evs = drain_events(&mut eng);
        assert!(matches!(evs.as_slice(), [Event::Error(ref s)] if s.contains("SnapshotRequired")));
    }

    #[test]
    fn notify_wal_durable_clamps_to_last_contiguous() {
        // Calling with a seq beyond what the engine has applied
        // in-memory must clamp — a host bug shouldn't trick the
        // engine into acking ops it never saw.
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        drive_to_idle(&mut eng);
        let _ = drain_outbox(&mut eng);
        let _ = drain_events(&mut eng);
        let blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "x").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredBlob { seq: 3, blob }],
        }));
        assert_eq!(eng.last_contiguous_seq(), 3);
        eng.notify_wal_durable(999);
        assert_eq!(eng.last_durable_seq(), 3);
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack"));
        assert!(matches!(ack, ClientFrame::Ack { last_acked_seq: 3 }));
    }

    #[test]
    fn notify_wal_durable_is_monotonic_and_coalesces() {
        // A backwards notify must not regress last_durable_seq.
        // Repeated notifies at the same value must not re-queue an
        // Ack (the same coalescing as `queue_ack_if_advanced`).
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        drive_to_idle(&mut eng);
        let _ = drain_outbox(&mut eng);
        let _ = drain_events(&mut eng);
        let b1 = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "a").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredBlob { seq: 5, blob: b1 }],
        }));
        assert!(eng.pop_outbox().is_none());

        eng.notify_wal_durable(5);
        let _ack: ClientFrame = dec(&eng.pop_outbox().expect("first Ack"));

        // Re-notify at 5 (e.g. a follow-up zero-bytes captureAndAppend
        // chain entry) — no duplicate Ack.
        eng.notify_wal_durable(5);
        assert!(eng.pop_outbox().is_none());

        // Notify backwards is a no-op.
        eng.notify_wal_durable(2);
        assert_eq!(eng.last_durable_seq(), 5);
        assert!(eng.pop_outbox().is_none());
    }

    #[test]
    fn inbound_apply_does_not_queue_ack_until_durable() {
        // Regression guard against the original bug: a remote op
        // arriving must NOT cause an Ack frame to land in the outbox
        // until `notify_wal_durable` says the WAL row is committed.
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        drive_to_idle(&mut eng);
        let _ = drain_outbox(&mut eng);
        let _ = drain_events(&mut eng);

        let blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "remote").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredBlob { seq: 4, blob }],
        }));

        // Engine has applied in memory but must not have queued an
        // Ack frame.
        assert_eq!(eng.last_contiguous_seq(), 4);
        assert_eq!(eng.last_durable_seq(), 0);
        while let Some(bytes) = eng.pop_outbox() {
            let frame: ClientFrame = dec(&bytes);
            assert!(
                !matches!(frame, ClientFrame::Ack { .. }),
                "outbox carried an Ack before notify_wal_durable: {frame:?}",
            );
        }
    }

    #[test]
    fn malformed_server_frame_emits_error_without_disconnect() {
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);
        eng.handle_server_bytes(b"not msgpack at all");
        let evs = drain_events(&mut eng);
        assert!(matches!(evs.as_slice(), [Event::Error(_)]));
        // Engine remains Idle — caller decides whether to disconnect.
        assert!(eng.is_idle());
    }

    #[test]
    fn end_to_end_two_engines_converge_via_engine_loop() {
        // Treat the test as a fake server: two engines pump frames at
        // each other. Validates the full apply/push/ack lifecycle and
        // that fingerprints converge after exchange.
        let dek = Dek::generate();
        let mut a = SyncEngine::new(Doc::new().unwrap(), dek.clone(), 0, opts());
        let mut b = {
            let mut doc = Doc::empty();
            // Mirror device-2 bootstrap: empty doc, will receive seed
            // via pull. Mark_pushed isn't right here — the empty doc
            // really has nothing pending — but we want to skip the
            // auto-push trigger anyway.
            doc.mark_pushed();
            SyncEngine::new(doc, dek.clone(), 0, opts())
        };

        let mut next_seq: u64 = 0;
        let mut ops_log: Vec<StoredBlob> = Vec::new();

        // Helper closure replaced with explicit flow because we can't
        // borrow mutably across `next_seq` + `ops_log` in a closure.

        // -- A connects --
        a.handle_connected();
        let _ = a.pop_outbox().unwrap();
        a.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let _ = a.pop_outbox().unwrap();
        a.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }));
        // A's seed auto-pushes; collect & ack.
        while let Some(bytes) = a.pop_outbox() {
            if let Ok(ClientFrame::PushOps { ops }) = rmp_serde::from_slice::<ClientFrame>(&bytes) {
                let assigned: Vec<u64> = ops
                    .into_iter()
                    .map(|blob| {
                        next_seq += 1;
                        ops_log.push(StoredBlob {
                            seq: next_seq,
                            blob,
                        });
                        next_seq
                    })
                    .collect();
                a.handle_server_bytes(&enc(&ServerFrame::OpsAck {
                    assigned_seqs: assigned,
                }));
            }
        }
        let _ = drain_outbox(&mut a);

        // -- A makes a local change and pushes --
        let item_a = a.doc_mut().add_item(LIST_MAIN, "from-a").unwrap();
        a.flush();
        let push: ClientFrame = dec(&a.pop_outbox().expect("PushOps"));
        let push_ops = match push {
            ClientFrame::PushOps { ops } => ops,
            other => panic!("expected push, got {other:?}"),
        };
        let assigned: Vec<u64> = push_ops
            .into_iter()
            .map(|blob| {
                next_seq += 1;
                ops_log.push(StoredBlob {
                    seq: next_seq,
                    blob,
                });
                next_seq
            })
            .collect();
        a.handle_server_bytes(&enc(&ServerFrame::OpsAck {
            assigned_seqs: assigned,
        }));
        let _ = drain_outbox(&mut a);

        // -- B connects, pulls everything from the log --
        b.handle_connected();
        let _ = b.pop_outbox().unwrap();
        b.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }));
        let _ = b.pop_outbox().unwrap();
        b.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: ops_log.clone(),
            complete: true,
        }));
        // B should now hold A's item.
        assert!(b.doc().get_item(&item_a).is_some());

        // Fingerprints converge.
        assert_eq!(a.doc().fingerprint(), b.doc().fingerprint());
    }
}
