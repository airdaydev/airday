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

use std::collections::{BTreeSet, VecDeque};

use airday_protocol::{
    ClientFrame, Hello, HelloAck, HelloRejected, ServerFrame, StoredBlob, PROTOCOL_VERSION,
};
use loro::VersionVector;
use serde::Serialize;

use crate::crypto::Dek;
use crate::doc::Doc;

/// Reorder-buffer cap. When an inbound seq stream has accumulated this
/// many out-of-order arrivals above `last_contiguous_seq` without the
/// hole closing, the engine escalates directly to the bootstrap tier
/// (see `spec/sync-protocol.md` "Buffer bound"). Bounds memory under
/// pathological replica lag.
///
/// Lowered under `cfg(test)` so a single test can exercise the
/// overflow path without delivering 10k blobs.
#[cfg(not(test))]
const MAX_REORDER_BUFFER: usize = 10_000;
#[cfg(test)]
const MAX_REORDER_BUFFER: usize = 10;
/// Base wait before the first gap-retry `PullOps`. Subsequent retries
/// double the wait (3s, then 6s, then 12s).
const GAP_RETRY_BASE_MS: u64 = 3_000;
/// Maximum number of gap-retry `PullOps` issues before escalating to
/// bootstrap.
const GAP_RETRY_LIMIT: u8 = 3;

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
    /// Reserved for the future "hard-stop" tier of gap escalation
    /// (`spec/sync-protocol.md` §"Escalation" case 3): a primary read
    /// confirms a missing seq has been genuinely lost server-side. Not
    /// emitted today — included in the API so hosts can build the
    /// surfacing path before the protocol message that triggers it
    /// lands. Local mutations continue when this fires; recovery is
    /// operational (server restore from backup), not protocol-level.
    SyncHalted { reason: String, missing_seq: u64 },
}

/// Identity advertised in the `Hello` frame. Set once at construction.
#[derive(Debug, Clone)]
pub struct EngineOptions {
    pub client_name: String,
    pub client_version: String,
}

/// Tracks an open hole in the inbound seq stream. Created when
/// `seen_above_contig` becomes non-empty; cleared when the buffer
/// drains. `next_retry_at_ms` is the absolute wall-clock millisecond
/// at which the next gap-retry `PullOps` is due; `retry_count` is the
/// number of retries already issued (caps at `GAP_RETRY_LIMIT` before
/// the engine escalates to bootstrap).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct GapState {
    since_ms: u64,
    next_retry_at_ms: u64,
    retry_count: u8,
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
    /// Out-of-order seqs received above `last_contiguous_seq`. A hole
    /// is implicit: any value in `(last_contiguous_seq, max)` not in
    /// this set is missing. Empty in production today (sqlite
    /// single-writer makes gaps structurally impossible); the
    /// mechanism exists ahead of the Postgres+replicas deploy so the
    /// safety invariant is built before a real gap can surface.
    seen_above_contig: BTreeSet<u64>,
    /// `Some` while `seen_above_contig` is non-empty. Tracks
    /// gap-retry pacing so the host's periodic `handle_timeout` calls
    /// know when to re-issue `PullOps` against (hopefully) a more
    /// caught-up replica.
    gap_state: Option<GapState>,
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
            seen_above_contig: BTreeSet::new(),
            gap_state: None,
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

    /// Caller's tick. Two responsibilities:
    ///
    ///   - Escalate the `Hello` handshake timeout (idempotent in
    ///     non-Hello states).
    ///   - Drive gap-retry pacing. When `seen_above_contig` is
    ///     non-empty, this is what re-issues `PullOps` after
    ///     exponential backoff (`spec/sync-protocol.md` "Escalation"
    ///     retry tier), and what escalates to bootstrap once
    ///     `GAP_RETRY_LIMIT` retries have elapsed.
    ///
    /// `now_ms` is monotonic milliseconds — the engine never reads a
    /// clock itself. Hosts call this periodically (e.g., every
    /// ~1s via setInterval / tokio::time::interval) AND after any
    /// `handle_server_bytes` call that may have opened a new gap.
    pub fn handle_timeout(&mut self, now_ms: u64) {
        if matches!(self.state, ConnState::Hello) {
            self.events
                .push_back(Event::Error("handshake timed out".into()));
            return;
        }
        self.tick_gap_retry(now_ms);
    }

    /// One frame's worth of bytes from the server. `now_ms` is used
    /// to stamp gap-open timing if an out-of-order seq arrives —
    /// monotonic milliseconds, supplied by the caller.
    pub fn handle_server_bytes(&mut self, bytes: &[u8], now_ms: u64) {
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
            | ConnState::PushingDirty => self.handle_server_frame(bytes, now_ms),
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

    fn handle_server_frame(&mut self, bytes: &[u8], now_ms: u64) {
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
                self.apply_remote_ops(ops, now_ms);
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
                self.apply_remote_ops(ops, now_ms);
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
                // Server bumps the per-account counter atomically, so
                // `assigned_seqs` is contiguous (the spec's
                // dense/gap-free invariant). Ingest each so contiguity
                // bookkeeping stays consistent with the inbound path.
                let prev_contig = self.last_contiguous_seq;
                for &seq in &assigned_seqs {
                    self.ingest_seq(seq, now_ms);
                }
                if self.last_contiguous_seq > prev_contig {
                    self.events.push_back(Event::FrontierAdvanced {
                        seq: self.last_contiguous_seq,
                    });
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
                // Snapshot supersedes any open gap below up_to_seq —
                // drop redundant buffered seqs and peel anything
                // contiguous above the new frontier.
                self.compact_seen_above_contig();
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

    fn apply_remote_ops(&mut self, ops: Vec<StoredBlob>, now_ms: u64) {
        if ops.is_empty() {
            return;
        }

        // Apply all blobs to Loro first — the CRDT tolerates
        // out-of-order arrivals (VV handles causality), so a hole at
        // the seq layer doesn't block doc convergence. This also
        // keeps the UI responsive under replica lag.
        if let Err(e) = self
            .doc
            .apply_remote_batch(&self.dek, ops.iter().map(|op| &op.blob))
        {
            let failed_seq = ops
                .iter()
                .find(|op| op.seq > self.last_contiguous_seq)
                .map(|op| op.seq)
                .unwrap_or_else(|| ops.iter().map(|op| op.seq).max().unwrap_or(0));
            self.events
                .push_back(Event::Error(format!("apply remote blob {failed_seq}: {e}")));
            return;
        }

        // Bookkeep each seq separately: advances over the contiguous
        // prefix, holes land in `seen_above_contig`. The Loro state
        // is already current — we just track what the *server* has
        // gotten back to us about.
        let prev_contig = self.last_contiguous_seq;
        for op in &ops {
            self.ingest_seq(op.seq, now_ms);
        }
        if self.last_contiguous_seq > prev_contig {
            self.events.push_back(Event::FrontierAdvanced {
                seq: self.last_contiguous_seq,
            });
        }

        // Reorder-buffer cap: too many out-of-order arrivals without
        // the hole closing is indistinguishable from "the seq is
        // never coming." Skip the retry tier, jump straight to
        // bootstrap.
        if self.seen_above_contig.len() > MAX_REORDER_BUFFER {
            self.escalate_to_bootstrap();
        }

        // Domain-level deltas (`AppEvent`) flow through `Doc`'s own
        // queue — drained by the host alongside this protocol event
        // queue. The engine no longer fires a coarse "OpsApplied"
        // signal; consumers poll `Doc::pop_event` for granular
        // `ItemAdded` / `ItemTextChanged` / etc.
    }

    /// Bookkeep a single inbound seq. Does not touch the Loro doc —
    /// callers are responsible for the apply.
    fn ingest_seq(&mut self, n: u64, now_ms: u64) {
        if n <= self.last_contiguous_seq {
            // Already covered by the contiguous prefix — drop.
            return;
        }
        if n == self.last_contiguous_seq + 1 {
            self.last_contiguous_seq = n;
            self.compact_seen_above_contig();
        } else {
            // n > last_contiguous_seq + 1 → hole somewhere below.
            // We don't fire an `Event::Error` here — under
            // Postgres+replicas an open gap is normal operation. Hosts
            // that want to observe can sample whatever telemetry hook
            // they wrap the engine with, or watch the gap-retry
            // `PullOps` frames appear in the outbox.
            let newly_inserted = self.seen_above_contig.insert(n);
            if newly_inserted && self.gap_state.is_none() {
                self.gap_state = Some(GapState {
                    since_ms: now_ms,
                    next_retry_at_ms: now_ms.saturating_add(GAP_RETRY_BASE_MS),
                    retry_count: 0,
                });
            }
        }
    }

    /// Drop redundant entries (seqs ≤ `last_contiguous_seq`) and peel
    /// any contiguous suffix off the buffer. Clears `gap_state` if
    /// the buffer empties. Called after every advance of
    /// `last_contiguous_seq` from `ingest_seq` or `Snapshot` apply.
    fn compact_seen_above_contig(&mut self) {
        loop {
            let Some(&next) = self.seen_above_contig.iter().next() else {
                break;
            };
            if next <= self.last_contiguous_seq {
                self.seen_above_contig.pop_first();
            } else if next == self.last_contiguous_seq + 1 {
                self.seen_above_contig.pop_first();
                self.last_contiguous_seq = next;
            } else {
                break;
            }
        }
        if self.seen_above_contig.is_empty() {
            self.gap_state = None;
        }
    }

    /// Periodic gap-retry tick. Called from `handle_timeout`. Issues
    /// `PullOps { since_seq: last_contiguous_seq }` once per backoff
    /// window (3s, 6s, 12s) while a buffered hole persists; on the
    /// `GAP_RETRY_LIMIT`-th miss, escalates to bootstrap.
    fn tick_gap_retry(&mut self, now_ms: u64) {
        let Some(gap) = self.gap_state else { return };
        if now_ms < gap.next_retry_at_ms {
            return;
        }
        if gap.retry_count >= GAP_RETRY_LIMIT {
            self.escalate_to_bootstrap();
            return;
        }
        // Don't pile retries on top of an in-flight bootstrap or
        // disconnected state — they wouldn't be answerable anyway.
        if matches!(
            self.state,
            ConnState::Bootstrapping | ConnState::Disconnected | ConnState::Hello
        ) {
            return;
        }
        let next_count = gap.retry_count + 1;
        let backoff = GAP_RETRY_BASE_MS.saturating_mul(1u64 << next_count.min(5));
        self.gap_state = Some(GapState {
            since_ms: gap.since_ms,
            next_retry_at_ms: now_ms.saturating_add(backoff),
            retry_count: next_count,
        });
        let frame = ClientFrame::PullOps {
            since_seq: self.last_contiguous_seq,
        };
        if let Err(e) = self.encode_into_outbox(&frame) {
            self.events.push_back(Event::Error(format!(
                "encode gap-retry PullOps: {e}"
            )));
        }
    }

    /// Jump to the bootstrap tier: clear gap state, emit
    /// `PullSnapshot`, transition to `Bootstrapping`. Used both on
    /// `seen_above_contig` overflow and on `GAP_RETRY_LIMIT`-exhausted
    /// timeouts. A snapshot's `up_to_seq` covers the missing seq's
    /// payload as part of the encoded state, so this is the cleanest
    /// recovery short of the (future) primary-confirmed hard-stop.
    fn escalate_to_bootstrap(&mut self) {
        self.seen_above_contig.clear();
        self.gap_state = None;
        if matches!(self.state, ConnState::Bootstrapping) {
            return;
        }
        if matches!(self.state, ConnState::Disconnected | ConnState::Hello) {
            // Can't bootstrap without a connection. Reconnect will
            // re-pull from `last_contiguous_seq` and either fill the
            // gap naturally or land back here.
            return;
        }
        self.state = ConnState::Bootstrapping;
        let frame = ClientFrame::PullSnapshot;
        if let Err(e) = self.encode_into_outbox(&frame) {
            self.events.push_back(Event::Error(format!(
                "encode PullSnapshot for gap escalation: {e}"
            )));
            self.go_disconnected();
        }
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
        // Drop the gap-retry timer on disconnect. The reorder buffer
        // itself stays — those ops are in the doc and the seqs are
        // legitimate observations of server state. On reconnect, the
        // resume `PullOps { since_seq: last_contiguous_seq }` may
        // re-deliver the missing seqs and the buffer drains; if not,
        // the next inbound out-of-order arrival re-arms the gap
        // timer.
        self.gap_state = None;
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
        }), 0);
        let _pull = eng.pop_outbox().expect("PullOps");
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }), 0);
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
        }), 0);
        let pull: ClientFrame = dec(&eng.pop_outbox().unwrap());
        assert!(matches!(pull, ClientFrame::PullOps { since_seq: 0 }));

        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }), 0);
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
        }), 0);
        let _pull = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }), 0);
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
        }), 0);
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
        }), 0);
        assert!(!eng.is_online());
        let events = drain_events(&mut eng);
        assert!(matches!(events[0], Event::Error(ref s) if s.contains("9999")));
    }

    #[test]
    fn handle_timeout_in_hello_emits_error_only() {
        let mut eng = fresh_engine_clean();
        eng.handle_timeout(0);
        assert!(
            drain_events(&mut eng).is_empty(),
            "no error in Disconnected"
        );

        eng.handle_connected();
        let _ = drain_events(&mut eng);
        let _ = drain_outbox(&mut eng);
        eng.handle_timeout(0);
        let evs = drain_events(&mut eng);
        assert!(matches!(evs.as_slice(), [Event::Error(ref s)] if s.contains("timed out")));

        // In Idle, timeout is a no-op.
        let mut eng2 = fresh_engine_clean();
        drive_to_idle(&mut eng2);
        let _ = drain_events(&mut eng2);
        eng2.handle_timeout(0);
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
        }), 0);
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
        }), 0);

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
        }), 0);
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
        }), 0);
        let _ = eng.pop_outbox().unwrap(); // PullOps

        // User mutates and flushes while we're still Pulling.
        eng.doc_mut().add_item(LIST_MAIN, "during pull").unwrap();
        eng.flush();
        assert!(eng.pop_outbox().is_none(), "Pulling defers push until Idle");

        // Pull completes — engine should self-trigger the push.
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }), 0);
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
        // OpsBroadcast at seq=1 (the contiguous next after the empty
        // initial pull). Higher seqs would land in the reorder buffer.
        let remote_blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "from peer").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredBlob {
                seq: 1,
                blob: remote_blob,
            }],
        }), 0);
        let events = drain_events(&mut eng);
        assert!(events.contains(&Event::FrontierAdvanced { seq: 1 }));
        // Granular AppEvent: the peer item shows up on the doc's queue.
        let app_evs: Vec<_> = std::iter::from_fn(|| eng.pop_app_event()).collect();
        assert!(
            app_evs
                .iter()
                .any(|e| matches!(e, crate::events::AppEvent::ItemAdded { text, .. } if text == "from peer")),
            "expected ItemAdded for `from peer` in {app_evs:?}"
        );
        assert_eq!(eng.last_contiguous_seq(), 1);
        assert_eq!(eng.last_durable_seq(), 0, "durable lags until notify");
        // No Ack until host confirms durability.
        assert!(
            eng.pop_outbox().is_none(),
            "Ack frame queued before notify_wal_durable",
        );
        eng.notify_wal_durable(1);
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack"));
        assert!(matches!(ack, ClientFrame::Ack { last_acked_seq: 1 }));

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
                    seq: 1,
                    blob: setup_blob,
                },
                StoredBlob {
                    seq: 2,
                    blob: edit_blob,
                },
            ],
            complete: false,
        }), 0);

        let events = drain_events(&mut eng);
        assert_eq!(events, vec![Event::FrontierAdvanced { seq: 2 }]);

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
        eng.notify_wal_durable(2);
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack"));
        assert!(matches!(ack, ClientFrame::Ack { last_acked_seq: 2 }));
        assert_eq!(eng.last_contiguous_seq(), 2);
        assert_eq!(eng.last_durable_seq(), 2);
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

        // Broadcast arrives during Pushing. seq=1 is the next
        // contiguous value (engine starts at 0); the server would
        // assign it to whichever device's push the primary committed
        // first.
        let remote_blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "peer-during-push").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredBlob {
                seq: 1,
                blob: remote_blob,
            }],
        }), 0);
        // State still Pushing — broadcast doesn't transition.
        assert!(!eng.is_idle());
        // Peer op applied.
        assert!(eng
            .doc()
            .items_in_list(LIST_MAIN, false)
            .iter()
            .any(|i| i.text == "peer-during-push"));

        // Server acks our push with seq 2 (continuing the contiguous
        // sequence after the broadcast at seq 1).
        eng.handle_server_bytes(&enc(&ServerFrame::OpsAck {
            assigned_seqs: vec![2],
        }), 0);
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
        }), 0);
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
        }), 0);
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
        }), 0);
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
        }), 0);
        let _ = eng.pop_outbox().unwrap();
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }), 0);
        let frame: ClientFrame = dec(&eng.pop_outbox().expect("re-push after reconnect"));
        assert!(matches!(frame, ClientFrame::PushOps { .. }));
    }

    #[test]
    fn server_bytes_while_disconnected_is_an_error() {
        let mut eng = fresh_engine_clean();
        eng.handle_server_bytes(b"\x00\x01", 0);
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
        }), 0);
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
        }), 0);
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
        // Bump our frontier via a contiguous broadcast at seq=1.
        // Under the new gap-aware engine, broadcasts with non-
        // contiguous seqs land in the reorder buffer instead of
        // advancing `last_contiguous_seq`. Numbers don't matter here
        // — only the invariant "engine's frontier ≥ requested up_to".
        let dek = eng.dek.clone();
        let bump_blob = make_remote_blob(&dek, |d| {
            d.add_item(LIST_MAIN, "from-peer").unwrap();
        });
        eng.handle_server_bytes(&enc(&ServerFrame::OpsBroadcast {
            ops: vec![StoredBlob {
                seq: 1,
                blob: bump_blob,
            }],
        }), 0);
        let _ = drain_outbox(&mut eng); // drop the auto-Ack

        // Server requests a snapshot at up_to=0 (below our current
        // frontier of 1) with shallow_start at 0.
        eng.handle_server_bytes(&enc(&ServerFrame::SnapshotRequest {
            up_to_seq: 0,
            shallow_start_seq: 0,
        }), 0);
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
        assert_eq!(tagged_up_to, 1);
        // Shallow start echoes the server's requested value verbatim.
        assert_eq!(tagged_shallow, 0);

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
        }), 0);
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
        }), 0);
        let _ = eng.pop_outbox().unwrap(); // PullOps

        // Server says cursor is below the floor.
        eng.handle_server_bytes(&enc(&ServerFrame::SnapshotRequired { up_to_seq: 42 }), 0);
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
        }), 0);

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
        }), 0);
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
        }), 0);
        let _ = eng.pop_outbox().unwrap(); // PullOps
        eng.handle_server_bytes(&enc(&ServerFrame::SnapshotRequired { up_to_seq: 10 }), 0);
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
        }), 0);
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
        }), 0);
        let _ = a.pop_outbox().unwrap();
        a.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }), 0);
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
                }), 0);
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
                }), 0);
            }
        }
        let _ = drain_outbox(&mut a);
        assert_eq!(a.last_contiguous_seq(), next_seq);

        // -- Server requests a snapshot from A. Single-device account,
        //    so horizon == next_seq; shallow_start equals up_to. --
        a.handle_server_bytes(&enc(&ServerFrame::SnapshotRequest {
            up_to_seq: next_seq,
            shallow_start_seq: next_seq,
        }), 0);
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
                }), 0);
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
        }), 0);
        let pull: ClientFrame = dec(&b.pop_outbox().unwrap());
        assert!(matches!(pull, ClientFrame::PullOps { since_seq: 0 }));

        // Fake server: since (0) < snapshot.up_to_seq, reply SnapshotRequired.
        b.handle_server_bytes(&enc(&ServerFrame::SnapshotRequired {
            up_to_seq: snapshot_up_to,
        }), 0);
        let pull_snap: ClientFrame = dec(&b.pop_outbox().expect("PullSnapshot"));
        assert!(matches!(pull_snap, ClientFrame::PullSnapshot));

        // Fake server: hand back the stored snapshot.
        b.handle_server_bytes(&enc(&ServerFrame::Snapshot {
            up_to_seq: snapshot_up_to,
            blob: snapshot_blob,
        }), 0);

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
        }), 0);
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
        eng.handle_server_bytes(&enc(&ServerFrame::SnapshotRequired { up_to_seq: 1 }), 0);
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
            ops: vec![StoredBlob { seq: 1, blob }],
        }), 0);
        assert_eq!(eng.last_contiguous_seq(), 1);
        eng.notify_wal_durable(999);
        assert_eq!(eng.last_durable_seq(), 1);
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack"));
        assert!(matches!(ack, ClientFrame::Ack { last_acked_seq: 1 }));
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
            ops: vec![StoredBlob { seq: 1, blob: b1 }],
        }), 0);
        assert!(eng.pop_outbox().is_none());

        eng.notify_wal_durable(1);
        let _ack: ClientFrame = dec(&eng.pop_outbox().expect("first Ack"));

        // Re-notify at 1 (e.g. a follow-up zero-bytes captureAndAppend
        // chain entry) — no duplicate Ack.
        eng.notify_wal_durable(1);
        assert!(eng.pop_outbox().is_none());

        // Notify backwards is a no-op.
        eng.notify_wal_durable(0);
        assert_eq!(eng.last_durable_seq(), 1);
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
            ops: vec![StoredBlob { seq: 1, blob }],
        }), 0);

        // Engine has applied in memory but must not have queued an
        // Ack frame.
        assert_eq!(eng.last_contiguous_seq(), 1);
        assert_eq!(eng.last_durable_seq(), 0);
        while let Some(bytes) = eng.pop_outbox() {
            let frame: ClientFrame = dec(&bytes);
            assert!(
                !matches!(frame, ClientFrame::Ack { .. }),
                "outbox carried an Ack before notify_wal_durable: {frame:?}",
            );
        }
    }

    /// Produce N independent encrypted blobs, each containing one
    /// "op-i" mutation. Each blob comes from a fresh peer Doc so the
    /// CRDT op IDs don't collide on import. Used for tests that need
    /// a stream of valid blobs without caring about their content.
    fn make_blob_stream(dek: &Dek, n: usize) -> Vec<airday_protocol::EncryptedBlob> {
        (0..n)
            .map(|i| {
                make_remote_blob(dek, |d| {
                    d.add_item(LIST_MAIN, &format!("op-{i}")).unwrap();
                })
            })
            .collect()
    }

    #[test]
    fn gap_fills_naturally_advancing_through_buffered_seqs() {
        // [1, 2, 4] then [3] — assert engine acks 2 first, then 4
        // (peeling the buffered seq from `seen_above_contig`).
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        drive_to_idle(&mut eng);
        let _ = drain_outbox(&mut eng);
        let _ = drain_events(&mut eng);

        let blobs = make_blob_stream(&dek, 4);
        eng.handle_server_bytes(
            &enc(&ServerFrame::OpsBatch {
                ops: vec![
                    StoredBlob {
                        seq: 1,
                        blob: blobs[0].clone(),
                    },
                    StoredBlob {
                        seq: 2,
                        blob: blobs[1].clone(),
                    },
                    StoredBlob {
                        seq: 4,
                        blob: blobs[3].clone(),
                    },
                ],
                complete: false,
            }),
            1_000,
        );

        // Contiguous prefix stopped at 2; 4 is buffered.
        assert_eq!(eng.last_contiguous_seq(), 2);
        eng.notify_wal_durable(2);
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("first Ack"));
        assert!(matches!(ack, ClientFrame::Ack { last_acked_seq: 2 }));

        // Missing seq arrives → engine peels 4 off the buffer.
        eng.handle_server_bytes(
            &enc(&ServerFrame::OpsBroadcast {
                ops: vec![StoredBlob {
                    seq: 3,
                    blob: blobs[2].clone(),
                }],
            }),
            1_100,
        );
        assert_eq!(eng.last_contiguous_seq(), 4);
        eng.notify_wal_durable(4);
        let ack: ClientFrame = dec(&eng.pop_outbox().expect("Ack 4"));
        assert!(matches!(ack, ClientFrame::Ack { last_acked_seq: 4 }));
    }

    #[test]
    fn gap_retry_emits_pullops_after_backoff() {
        // [1, 2, 4] held; tick simulated clock past 3s / 9s and
        // assert the engine emits fresh `PullOps { since_seq: 2 }`
        // frames at the matching backoff windows.
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        drive_to_idle(&mut eng);
        let _ = drain_outbox(&mut eng);
        let _ = drain_events(&mut eng);

        let blobs = make_blob_stream(&dek, 4);
        let gap_open_ms = 1_000;
        eng.handle_server_bytes(
            &enc(&ServerFrame::OpsBatch {
                ops: vec![
                    StoredBlob {
                        seq: 1,
                        blob: blobs[0].clone(),
                    },
                    StoredBlob {
                        seq: 2,
                        blob: blobs[1].clone(),
                    },
                    StoredBlob {
                        seq: 4,
                        blob: blobs[3].clone(),
                    },
                ],
                complete: false,
            }),
            gap_open_ms,
        );
        let _ = drain_outbox(&mut eng);

        // Just before the 3s threshold — no retry yet.
        eng.handle_timeout(gap_open_ms + 2_999);
        assert!(eng.pop_outbox().is_none(), "no retry before backoff window");

        // At the 3s threshold — retry #1 fires with since_seq=2.
        eng.handle_timeout(gap_open_ms + 3_000);
        let frame: ClientFrame = dec(&eng.pop_outbox().expect("retry #1"));
        assert!(
            matches!(frame, ClientFrame::PullOps { since_seq: 2 }),
            "expected PullOps{{since_seq:2}}, got {frame:?}",
        );

        // Between retry #1 and the next backoff (6s after retry #1
        // fired) — no further retry.
        eng.handle_timeout(gap_open_ms + 5_000);
        assert!(eng.pop_outbox().is_none(), "second backoff not yet elapsed");

        // 6s after retry #1 → retry #2.
        eng.handle_timeout(gap_open_ms + 9_001);
        let frame: ClientFrame = dec(&eng.pop_outbox().expect("retry #2"));
        assert!(matches!(frame, ClientFrame::PullOps { since_seq: 2 }));
    }

    #[test]
    fn gap_escalates_to_bootstrap_after_exhausted_retries() {
        // Same setup as the retry test, but drive past
        // GAP_RETRY_LIMIT retries — engine emits `PullSnapshot` and
        // transitions to `Bootstrapping`.
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        drive_to_idle(&mut eng);
        let _ = drain_outbox(&mut eng);
        let _ = drain_events(&mut eng);

        let blobs = make_blob_stream(&dek, 4);
        eng.handle_server_bytes(
            &enc(&ServerFrame::OpsBatch {
                ops: vec![
                    StoredBlob {
                        seq: 1,
                        blob: blobs[0].clone(),
                    },
                    StoredBlob {
                        seq: 2,
                        blob: blobs[1].clone(),
                    },
                    StoredBlob {
                        seq: 4,
                        blob: blobs[3].clone(),
                    },
                ],
                complete: false,
            }),
            1_000,
        );
        let _ = drain_outbox(&mut eng);

        // Fire retries #1, #2, #3 at backoff windows.
        // 3s, then +6s = 9s, then +12s = 21s after gap open.
        for &deadline in &[1_000 + 3_000, 1_000 + 9_001, 1_000 + 21_002] {
            eng.handle_timeout(deadline);
            let frame: ClientFrame = dec(&eng.pop_outbox().expect("retry"));
            assert!(matches!(frame, ClientFrame::PullOps { since_seq: 2 }));
        }
        // Engine should still be idle (not bootstrapping) — three
        // retries fired.
        assert!(eng.is_idle());

        // One more tick past the next backoff (24s after retry #3 =
        // 21002 + 24000 = 45002) — engine escalates to bootstrap.
        eng.handle_timeout(1_000 + 45_003);
        let frame: ClientFrame = dec(&eng.pop_outbox().expect("PullSnapshot"));
        assert!(
            matches!(frame, ClientFrame::PullSnapshot),
            "expected PullSnapshot after exhausted retries, got {frame:?}",
        );
        assert!(!eng.is_idle(), "engine should be Bootstrapping");
    }

    #[test]
    fn buffer_overflow_escalates_directly_to_bootstrap() {
        // MAX_REORDER_BUFFER = 10 under cfg(test). Deliver a contiguous
        // pair plus enough out-of-order seqs to exceed the cap —
        // engine skips the retry tier and emits `PullSnapshot` on the
        // same call.
        let mut eng = fresh_engine_clean();
        let dek = eng.dek.clone();
        drive_to_idle(&mut eng);
        let _ = drain_outbox(&mut eng);
        let _ = drain_events(&mut eng);

        // 2 contiguous + 11 out-of-order = 11 entries in the buffer,
        // > MAX_REORDER_BUFFER (10).
        let blobs = make_blob_stream(&dek, 14);
        let mut ops = vec![
            StoredBlob {
                seq: 1,
                blob: blobs[0].clone(),
            },
            StoredBlob {
                seq: 2,
                blob: blobs[1].clone(),
            },
        ];
        for (i, blob) in blobs[3..14].iter().enumerate() {
            ops.push(StoredBlob {
                seq: 4 + i as u64,
                blob: blob.clone(),
            });
        }
        eng.handle_server_bytes(
            &enc(&ServerFrame::OpsBatch {
                ops,
                complete: false,
            }),
            1_000,
        );

        // PullSnapshot should have been emitted on the same call.
        let mut saw_pull_snapshot = false;
        while let Some(bytes) = eng.pop_outbox() {
            if let Ok(ClientFrame::PullSnapshot) = rmp_serde::from_slice::<ClientFrame>(&bytes) {
                saw_pull_snapshot = true;
            }
        }
        assert!(saw_pull_snapshot, "expected PullSnapshot from buffer overflow");
        assert!(!eng.is_idle(), "engine should be Bootstrapping");
    }

    #[test]
    fn malformed_server_frame_emits_error_without_disconnect() {
        let mut eng = fresh_engine_clean();
        drive_to_idle(&mut eng);
        let _ = drain_events(&mut eng);
        eng.handle_server_bytes(b"not msgpack at all", 0);
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
        }), 0);
        let _ = a.pop_outbox().unwrap();
        a.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: vec![],
            complete: true,
        }), 0);
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
                }), 0);
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
        }), 0);
        let _ = drain_outbox(&mut a);

        // -- B connects, pulls everything from the log --
        b.handle_connected();
        let _ = b.pop_outbox().unwrap();
        b.handle_server_bytes(&enc(&HelloAck {
            server_version: "s".into(),
            protocol_version: PROTOCOL_VERSION,
        }), 0);
        let _ = b.pop_outbox().unwrap();
        b.handle_server_bytes(&enc(&ServerFrame::OpsBatch {
            ops: ops_log.clone(),
            complete: true,
        }), 0);
        // B should now hold A's item.
        assert!(b.doc().get_item(&item_a).is_some());

        // Fingerprints converge.
        assert_eq!(a.doc().fingerprint(), b.doc().fingerprint());
    }
}
