//! In-memory subscriber registry for op broadcast.
//!
//! Each connected sync session subscribes; pushes from one device fan
//! out to peer sessions on the same account. The fan-out delivers
//! pre-encoded msgpack bytes so we encode once per push, not once per
//! peer.
//!
//! **Backpressure policy.** Each subscriber gets a bounded mpsc
//! (`CHANNEL_CAPACITY`). On a full or closed channel the broadcast
//! drops the message *and* removes the subscriber. The session task
//! observes its rx going `None` and exits; the client reconnects and
//! pulls from `last_acked_op_id`. The op stream is the durable
//! channel — broadcast is just an optimization to skip the round-trip
//! when peers are live, so dropping a frame is safe.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use airday_protocol::{ServerFrame, StoredOp};
use tokio::sync::mpsc;
use uuid::Uuid;

/// Per-subscriber buffer. 256 frames × ~256 KiB worst case = ~64 MiB
/// upper bound on a single hung subscriber. Sized for two-device
/// usage; tune up when we bump device count or down when we add real
/// memory accounting.
const CHANNEL_CAPACITY: usize = 256;

#[derive(Clone, Default)]
pub struct SyncSessions {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Default)]
struct Inner {
    accounts: HashMap<Uuid, Vec<Subscriber>>,
}

struct Subscriber {
    sub_id: u64,
    device_id: Uuid,
    tx: mpsc::Sender<Vec<u8>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectedSubscriber {
    pub sub_id: u64,
    pub device_id: Uuid,
}

/// RAII subscription handle. Dropping deregisters the subscriber.
pub struct Subscription {
    sessions: SyncSessions,
    account_id: Uuid,
    sub_id: u64,
    pub rx: mpsc::Receiver<Vec<u8>>,
}

impl Subscription {
    /// Per-connection subscriber id. Pass to `broadcast` so a push from
    /// this session is excluded only from *its own* WS, not from peer
    /// tabs that happen to share the same `device_id`.
    pub fn sub_id(&self) -> u64 {
        self.sub_id
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self.sessions.unsubscribe(self.account_id, self.sub_id);
    }
}

impl SyncSessions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self, account_id: Uuid, device_id: Uuid) -> Subscription {
        let (tx, rx) = mpsc::channel(CHANNEL_CAPACITY);
        let sub_id = next_sub_id();
        let mut inner = self.inner.lock().unwrap();
        inner
            .accounts
            .entry(account_id)
            .or_default()
            .push(Subscriber {
                sub_id,
                device_id,
                tx,
            });
        Subscription {
            sessions: self.clone(),
            account_id,
            sub_id,
            rx,
        }
    }

    fn unsubscribe(&self, account_id: Uuid, sub_id: u64) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(subs) = inner.accounts.get_mut(&account_id) {
            subs.retain(|s| s.sub_id != sub_id);
            if subs.is_empty() {
                inner.accounts.remove(&account_id);
            }
        }
    }

    /// Fan out an op set to every subscriber on `account_id` except
    /// `exclude_sub`. Excluding by `sub_id` rather than `device_id`
    /// matters for multi-tab on the same device — both tabs share the
    /// device cookie, so a `device_id` filter would silence tab-to-tab
    /// broadcast on the same device. Each WS connection still gets a
    /// fresh `sub_id` so the originating tab is excluded but its peer
    /// tabs receive the frame.
    ///
    /// Returns the number of subscribers that received it (slow /
    /// closed receivers are dropped from the registry as a side
    /// effect).
    pub fn broadcast(&self, account_id: Uuid, exclude_sub: u64, ops: Vec<StoredOp>) -> usize {
        if ops.is_empty() {
            return 0;
        }
        let bytes = match rmp_serde::to_vec_named(&ServerFrame::OpsBroadcast { ops }) {
            Ok(b) => b,
            Err(e) => {
                tracing::error!(error = %e, "failed to encode OpsBroadcast");
                return 0;
            }
        };
        let mut delivered = 0;
        let mut inner = self.inner.lock().unwrap();
        if let Some(subs) = inner.accounts.get_mut(&account_id) {
            subs.retain(|s| {
                if s.sub_id == exclude_sub {
                    return true;
                }
                match s.tx.try_send(bytes.clone()) {
                    Ok(()) => {
                        delivered += 1;
                        true
                    }
                    // Channel full or closed: drop the subscriber. The
                    // peer's session loop sees `rx` go `None` and the
                    // client reconnects + pulls.
                    Err(_) => false,
                }
            });
        }
        delivered
    }

    /// Send a `SnapshotRequest` to a specific subscriber. Returns
    /// `true` if the frame was queued. The orchestrator (when it
    /// lands) picks the candidate and calls this; tests use it to
    /// drive the producer path without a live orchestrator.
    ///
    /// Targeted by `sub_id` rather than account-wide: the spec picks
    /// at most one device to produce, and even if multiple sessions
    /// share a device (multi-tab) we only want one to do the work.
    pub fn request_snapshot(&self, account_id: Uuid, sub_id: u64, up_to_op_id: u64) -> bool {
        let bytes = match rmp_serde::to_vec_named(&ServerFrame::SnapshotRequest { up_to_op_id }) {
            Ok(b) => b,
            Err(e) => {
                tracing::error!(error = %e, "failed to encode SnapshotRequest");
                return false;
            }
        };
        let mut inner = self.inner.lock().unwrap();
        let Some(subs) = inner.accounts.get_mut(&account_id) else {
            return false;
        };
        let mut delivered = false;
        subs.retain(|s| {
            if s.sub_id != sub_id {
                return true;
            }
            match s.tx.try_send(bytes.clone()) {
                Ok(()) => {
                    delivered = true;
                    true
                }
                // Same drop-and-deregister policy as `broadcast`.
                Err(_) => false,
            }
        });
        delivered
    }

    /// Snapshot the current subscriber ids for an account. Used by
    /// tests (and the future orchestrator) as input to candidate
    /// selection. Order is not stable — caller must apply its own
    /// ordering policy.
    pub fn subscriber_ids(&self, account_id: Uuid) -> Vec<u64> {
        let inner = self.inner.lock().unwrap();
        inner
            .accounts
            .get(&account_id)
            .map(|s| s.iter().map(|sub| sub.sub_id).collect())
            .unwrap_or_default()
    }

    /// Live subscriber count for an account. Used by integration tests
    /// to wait until a freshly-connected peer is registered before
    /// pushing into the broadcast path.
    pub fn subscriber_count(&self, account_id: Uuid) -> usize {
        let inner = self.inner.lock().unwrap();
        inner
            .accounts
            .get(&account_id)
            .map(|s| s.len())
            .unwrap_or(0)
    }

    pub fn connected_subscribers(&self, account_id: Uuid) -> Vec<ConnectedSubscriber> {
        let inner = self.inner.lock().unwrap();
        inner
            .accounts
            .get(&account_id)
            .map(|subs| {
                subs.iter()
                    .map(|sub| ConnectedSubscriber {
                        sub_id: sub.sub_id,
                        device_id: sub.device_id,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

fn next_sub_id() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}
