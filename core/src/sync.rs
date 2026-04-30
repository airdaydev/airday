//! Sans-IO sync engine: the protocol state machine in shared Rust.
//!
//! The engine owns no socket, no clock, no thread. The caller (CLI's
//! tokio adapter, the browser's `WebSocket`, mobile's `URLSession` /
//! OkHttp) feeds it transport events via `handle_*` and drains
//! ready-to-send frame bytes via `pop_outbox()` and engine events via
//! `pop_event()`.
//!
//! See `sync-engine.md` for the design rationale and the state diagram
//! reproduced below:
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
    ClientFrame, Hello, HelloAck, HelloRejected, ServerFrame, StoredOp, PROTOCOL_VERSION,
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
    /// The highest server-assigned op id we know about advanced to
    /// `id`. Useful for callers persisting `last_acked_op_id` between
    /// sessions.
    FrontierAdvanced { id: u64 },
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
    Idle,
    Pushing,
    PushingDirty,
}

pub struct SyncEngine {
    doc: Doc,
    dek: Dek,
    opts: EngineOptions,
    state: ConnState,
    /// Highest server-assigned op id we've seen — from pulls,
    /// broadcasts, or our own push acks.
    highest_seen_op_id: u64,
    /// Highest op id we've already shipped in an `Ack`. Lets us
    /// coalesce: queue an `Ack` only when `highest_seen_op_id` overtakes
    /// this.
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
    /// Build a fresh engine. `last_acked_op_id` is the persisted
    /// frontier from the previous session — used as `since_op_id` in
    /// the initial pull.
    pub fn new(doc: Doc, dek: Dek, last_acked_op_id: u64, opts: EngineOptions) -> Self {
        Self {
            doc,
            dek,
            opts,
            state: ConnState::Disconnected,
            highest_seen_op_id: last_acked_op_id,
            last_sent_ack: last_acked_op_id,
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

    /// Highest server-assigned op id known to the engine — caller
    /// persists this as `last_acked_op_id` between sessions.
    pub fn highest_seen_op_id(&self) -> u64 {
        self.highest_seen_op_id
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
            ConnState::Pulling | ConnState::Idle | ConnState::Pushing | ConnState::PushingDirty => {
                self.handle_server_frame(bytes)
            }
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
                since_op_id: self.highest_seen_op_id,
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
                self.apply_remote_ops(ops);
                self.queue_ack_if_advanced();
                if complete && matches!(self.state, ConnState::Pulling) {
                    self.state = ConnState::Idle;
                    self.events.push_back(Event::PulledInitial);
                    // If the user mutated during the pull, ship now.
                    self.try_start_push();
                }
            }
            ServerFrame::OpsBroadcast { ops } => {
                self.apply_remote_ops(ops);
                self.queue_ack_if_advanced();
            }
            ServerFrame::OpsAck { assigned_ids } => {
                if !matches!(self.state, ConnState::Pushing | ConnState::PushingDirty) {
                    self.events.push_back(Event::Error(format!(
                        "OpsAck received in unexpected state {:?}",
                        self.state
                    )));
                    return;
                }
                if let Some(top) = assigned_ids.iter().copied().max() {
                    if top > self.highest_seen_op_id {
                        self.highest_seen_op_id = top;
                        self.events.push_back(Event::FrontierAdvanced { id: top });
                    }
                }
                if let Some(vv) = self.in_flight_push_vv.take() {
                    self.doc.mark_pushed_at(vv);
                }
                self.events.push_back(Event::Pushed);
                self.queue_ack_if_advanced();
                let was_dirty = matches!(self.state, ConnState::PushingDirty);
                self.state = ConnState::Idle;
                if was_dirty {
                    // Re-export with the new oplog state and ship the
                    // mutations made during the in-flight push.
                    self.try_start_push();
                }
            }
            ServerFrame::SnapshotRequest { .. } | ServerFrame::Snapshot { .. } => {
                // Snapshot orchestration is out of scope for this slice
                // (see sync-engine.md "Out of scope"). Ignore rather
                // than error so a probing server doesn't break us.
            }
        }
    }

    fn apply_remote_ops(&mut self, ops: Vec<StoredOp>) {
        if ops.is_empty() {
            return;
        }
        for op in ops {
            match self.doc.apply_remote(&self.dek, &op.blob) {
                Ok(()) => {
                    if op.id > self.highest_seen_op_id {
                        self.highest_seen_op_id = op.id;
                        self.events.push_back(Event::FrontierAdvanced { id: op.id });
                    }
                }
                Err(e) => {
                    self.events
                        .push_back(Event::Error(format!("apply remote op {}: {e}", op.id)));
                    return;
                }
            }
        }
        // Domain-level deltas (`AppEvent`) flow through `Doc`'s own
        // queue — drained by the host alongside this protocol event
        // queue. The engine no longer fires a coarse "OpsApplied"
        // signal; consumers poll `Doc::pop_event` for granular
        // `ItemAdded` / `ItemTextChanged` / etc.
    }

    fn queue_ack_if_advanced(&mut self) {
        if self.highest_seen_op_id > self.last_sent_ack {
            let ack = ClientFrame::Ack {
                last_acked_op_id: self.highest_seen_op_id,
            };
            if self.encode_into_outbox(&ack).is_ok() {
                self.last_sent_ack = self.highest_seen_op_id;
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
    use airday_protocol::{EncryptedBlob, ServerFrame, StoredOp};

    fn opts() -> EngineOptions {
        EngineOptions {
            client_name: "test".into(),
            client_version: "0.0.0".into(),
        }
    }

    /// Engine over a fresh seeded doc — `has_pending_ops` starts true
    /// (the seed is unpushed), so pull-complete will auto-push the
    /// seed. Used only by tests that explicitly exercise the seed
    /// auto-push behavior; everything else uses `fresh_engine_clean`.
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
        assert!(matches!(pull, ClientFrame::PullOps { since_op_id: 0 }));

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
    fn pull_complete_auto_pushes_pending_seed() {
        // `fresh_engine` retains the unpushed seed: the seed lists
        // (`Current`, `Holding`) need to ship to the server before
        // peers can write into them. On pull-complete, the engine
        // detects pending ops and self-triggers a push.
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
        let push: ClientFrame = dec(&eng.pop_outbox().expect("seed PushOps"));
        assert!(matches!(push, ClientFrame::PushOps { .. }));
        // Engine is now Pushing, not Idle, until the ack arrives.
        assert!(!eng.is_idle());
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
            assigned_ids: vec![1],
        }));
        assert!(eng.is_idle());
        let events = drain_events(&mut eng);
        assert!(events.contains(&Event::Pushed));
        assert!(events.contains(&Event::FrontierAdvanced { id: 1 }));

        // After ack we must also have queued an Ack frame.
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack"));
        assert!(matches!(
            ack,
            ClientFrame::Ack {
                last_acked_op_id: 1
            }
        ));

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
            assigned_ids: vec![1],
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
            assigned_ids: vec![2],
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
        // OpsBroadcast with an assigned id of 7.
        let remote_blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "from peer").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredOp {
                id: 7,
                blob: remote_blob,
            }],
        }));
        let events = drain_events(&mut eng);
        assert!(events.contains(&Event::FrontierAdvanced { id: 7 }));
        // Granular AppEvent: the peer item shows up on the doc's queue.
        let app_evs: Vec<_> =
            std::iter::from_fn(|| eng.pop_app_event()).collect();
        assert!(
            app_evs
                .iter()
                .any(|e| matches!(e, crate::events::AppEvent::ItemAdded { text, .. } if text == "from peer")),
            "expected ItemAdded for `from peer` in {app_evs:?}"
        );
        assert_eq!(eng.highest_seen_op_id(), 7);
        // Frontier advance should produce an Ack.
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack"));
        assert!(matches!(
            ack,
            ClientFrame::Ack {
                last_acked_op_id: 7
            }
        ));

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
    fn broadcast_during_pushing_does_not_clobber_in_flight() {
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);

        // Mutate locally, start a push.
        eng.doc_mut()
            .add_item(LIST_MAIN, "local-pushing")
            .unwrap();
        eng.flush();
        let _ = eng.pop_outbox().expect("PushOps");

        // Broadcast arrives during Pushing.
        let remote_blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "peer-during-push").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredOp {
                id: 5,
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

        // Server acks our push with id 6.
        eng.handle_server_bytes(&enc(&ServerFrame::OpsAck {
            assigned_ids: vec![6],
        }));
        assert!(eng.is_idle());
        // Drain the post-ack housekeeping (Ack frame queued from
        // frontier advance) so the next assertion sees only what
        // `flush()` produces.
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
            ops: vec![StoredOp { id: 1, blob: blob1 }],
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
            ops: vec![StoredOp { id: 2, blob: blob2 }],
            complete: true,
        }));
        assert!(eng.is_idle());
        let events = drain_events(&mut eng);
        assert!(events.contains(&Event::PulledInitial));
        assert_eq!(eng.highest_seen_op_id(), 2);
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
            assigned_ids: vec![42],
        }));
        let evs = drain_events(&mut eng);
        assert!(matches!(evs.as_slice(), [Event::Error(ref s)] if s.contains("OpsAck")));
    }

    #[test]
    fn since_op_id_carries_persisted_frontier() {
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
        assert!(matches!(pull, ClientFrame::PullOps { since_op_id: 42 }));
    }

    #[test]
    fn snapshot_frames_ignored_without_error() {
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);
        eng.handle_server_bytes(&enc(&ServerFrame::SnapshotRequest { up_to_op_id: 99 }));
        assert!(drain_events(&mut eng).is_empty());
        assert!(eng.pop_outbox().is_none());
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

        let mut next_id: u64 = 0;
        let mut ops_log: Vec<StoredOp> = Vec::new();

        // Helper closure replaced with explicit flow because we can't
        // borrow mutably across `next_id` + `ops_log` in a closure.

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
                        next_id += 1;
                        ops_log.push(StoredOp { id: next_id, blob });
                        next_id
                    })
                    .collect();
                a.handle_server_bytes(&enc(&ServerFrame::OpsAck {
                    assigned_ids: assigned,
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
                next_id += 1;
                ops_log.push(StoredOp { id: next_id, blob });
                next_id
            })
            .collect();
        a.handle_server_bytes(&enc(&ServerFrame::OpsAck {
            assigned_ids: assigned,
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
