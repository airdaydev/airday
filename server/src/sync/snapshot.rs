use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use std::{collections::HashMap, sync::Mutex, time::Duration};
use uuid::Uuid;

// Default threshold: 10k *op blobs* (each is one encrypted PushOps push;
// see `spec/sync-protocol.md` §"Terminology") since the last snapshot
// makes an account eligible. Operators override via
// `snapshot_threshold_blobs` in the server config (or
// `AIRDAY_SNAPSHOT_THRESHOLD_BLOBS`); JS e2e tests drop it to a handful
// so the snapshot path runs in seconds.
// Timeout after 5 minutes
pub const SNAPSHOT_THRESHOLD_BLOBS: u64 = 10_000;
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

struct ActiveLease {
    lease_id: u64,
    expires_at: Instant,
}

enum LeaseState {
    Idle,
    Active(ActiveLease),
}

#[derive(Clone)]
pub struct SnapshotCoordinator {
    timeout: Duration, // Maximum time to allow device to return a snapshot
    threshold_blobs: u64,
    leases: Arc<Mutex<HashMap<Uuid, LeaseState>>>,
    next_lease_id: Arc<AtomicU64>,
}

pub enum Decision {
    Issue {
        lease_id: u64,
        /// State frontier the snapshot will be encoded at (= producer's
        /// `last_acked_seq`, = `server_last_seq` since producer
        /// must be caught up).
        up_to_seq: u64,
        /// Retained-history boundary (= horizon). Doubles as the
        /// compaction floor once the snapshot lands.
        shallow_start_seq: u64,
    },
    Skip,
}

pub enum ReleaseResult {
    Accepted,
    Stale, // covers both "wrong lease_id" and "no active lease"
}

impl SnapshotCoordinator {
    pub fn new() -> Self {
        Self::with_config(SNAPSHOT_THRESHOLD_BLOBS, SNAPSHOT_TIMEOUT)
    }

    pub fn with_threshold_blobs(threshold_blobs: u64) -> Self {
        Self::with_config(threshold_blobs, SNAPSHOT_TIMEOUT)
    }

    pub fn with_config(threshold_blobs: u64, timeout: Duration) -> Self {
        Self {
            timeout,
            threshold_blobs,
            leases: Arc::new(Mutex::new(HashMap::new())),
            next_lease_id: Arc::new(AtomicU64::new(1)),
        }
    }
    /// Trigger (see `spec/sync-protocol.md` §"Snapshot orchestration"):
    ///
    /// 1. `server_last_seq − latest snapshot's up_to_seq > threshold`
    ///    — enough new content for a new snapshot to materially cut
    ///    bootstrap cost (smaller `PullOps` catch-up after import).
    /// 2. The triggering device is caught up
    ///    (`device_last_acked_seq == server_last_seq`) — that
    ///    value is what we hand back as `up_to_seq`. Lagging
    ///    connections are skipped as producers (still contribute to
    ///    horizon).
    ///
    /// Horizon is **not** a trigger condition — a new snapshot at an
    /// unchanged `shallow_start_seq` still pays off for bootstrap
    /// even when no further compaction is possible.
    ///
    /// `shallow_start_seq = max(horizon, prev_snap_shallow)`. The
    /// `max` enforces monotonicity: if a new device's join drops
    /// horizon below the existing floor, we can't undo prior
    /// compaction, so the floor stays put.
    pub fn evaluate(
        &self,
        account: Uuid,
        server_snapshot_up_to_seq: u64, // latest snapshot's state frontier
        server_snapshot_shallow_seq: u64, // latest snapshot's shallow start
        server_last_seq: u64,           // latest seq on server for this account
        horizon_seq: u64,               // min(last_acked) across devices
        device_last_acked_seq: u64,     // triggering device's frontier
        now: Instant,
    ) -> Decision {
        // Not enough new content to bother.
        if server_last_seq.saturating_sub(server_snapshot_up_to_seq) < self.threshold_blobs {
            return Decision::Skip;
        }
        // Triggering device isn't caught up — can't be producer.
        if device_last_acked_seq != server_last_seq {
            return Decision::Skip;
        }
        let mut leases = self
            .leases
            .lock()
            .expect("snapshot coordinator mutex poisoned");
        let lease_state = leases.entry(account).or_insert_with(|| LeaseState::Idle);
        if let LeaseState::Active(lease) = lease_state {
            if now < lease.expires_at {
                return Decision::Skip;
            }
        }
        let lease_id = self.next_lease_id.fetch_add(1, Ordering::Relaxed);
        *lease_state = LeaseState::Active(ActiveLease {
            lease_id,
            expires_at: now + self.timeout,
        });
        Decision::Issue {
            lease_id,
            up_to_seq: device_last_acked_seq,
            shallow_start_seq: horizon_seq.max(server_snapshot_shallow_seq),
        }
    }
    pub fn release(&self, account: Uuid, incoming_lease_id: u64) -> ReleaseResult {
        let mut leases = self
            .leases
            .lock()
            .expect("snapshot coordinator mutex poisoned");
        if let Some(lease_state) = leases.get_mut(&account) {
            return match lease_state {
                LeaseState::Idle => ReleaseResult::Stale,
                LeaseState::Active(server_lease) => {
                    if server_lease.lease_id == incoming_lease_id {
                        *lease_state = LeaseState::Idle;
                        ReleaseResult::Accepted
                    } else {
                        ReleaseResult::Stale
                    }
                }
            };
        }
        ReleaseResult::Stale
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Signature reminder:
    //   evaluate(account, snap_up_to, snap_shallow, server_last,
    //            horizon, device_last_acked, now)

    #[test]
    fn issues_when_threshold_exceeded_horizon_advances_and_producer_caught_up() {
        let coord = SnapshotCoordinator::new();
        let account = Uuid::now_v7();
        let now = Instant::now();

        // Within default threshold (10k) — skip.
        let decision = coord.evaluate(account, 5_000, 5_000, 12_000, 12_000, 12_000, now);
        assert!(matches!(decision, Decision::Skip));

        // Producer not caught up — skip.
        let decision = coord.evaluate(account, 0, 0, 12_000, 11_999, 11_999, now);
        assert!(matches!(decision, Decision::Skip));

        // All preconditions met — issue.
        let decision = coord.evaluate(account, 0, 0, 12_000, 12_000, 12_000, now);
        assert!(matches!(
            decision,
            Decision::Issue {
                up_to_seq: 12_000,
                shallow_start_seq: 12_000,
                ..
            }
        ));
        let Decision::Issue { lease_id, .. } = decision else {
            panic!("should issue")
        };

        // In-flight — skip second request.
        let decision = coord.evaluate(account, 0, 0, 22_000, 22_000, 22_000, now);
        assert!(matches!(decision, Decision::Skip));

        let result = coord.release(account, lease_id);
        assert!(matches!(result, ReleaseResult::Accepted));

        // After release, issues again.
        let decision_2 = coord.evaluate(account, 0, 0, 22_000, 22_000, 22_000, now);
        assert!(matches!(
            decision_2,
            Decision::Issue {
                up_to_seq: 22_000,
                shallow_start_seq: 22_000,
                ..
            }
        ));

        // Expired lease — issues again.
        let decision = coord.evaluate(
            account,
            0,
            0,
            12_000,
            12_000,
            12_000,
            now + coord.timeout + Duration::from_secs(300),
        );
        assert!(matches!(
            decision,
            Decision::Issue {
                up_to_seq: 12_000,
                ..
            }
        ));
    }

    #[test]
    fn issues_with_unchanged_shallow_when_horizon_pinned() {
        // Lagger pins horizon at the existing shallow_start. New
        // snapshot still issued for bootstrap perf (state frontier
        // advances), but shallow_start stays put — no new compaction.
        let coord = SnapshotCoordinator::new();
        let account = Uuid::now_v7();
        let now = Instant::now();

        let decision = coord.evaluate(account, 10_000, 10_000, 22_000, 10_000, 22_000, now);
        assert!(matches!(
            decision,
            Decision::Issue {
                up_to_seq: 22_000,
                shallow_start_seq: 10_000,
                ..
            }
        ));
    }

    #[test]
    fn shallow_start_never_regresses() {
        // Horizon dipped below the existing shallow_start (e.g., a new
        // device joined with last_acked=0). Compaction can't unwind,
        // so the new snapshot's shallow_start is clamped up to the
        // existing floor.
        let coord = SnapshotCoordinator::new();
        let account = Uuid::now_v7();
        let now = Instant::now();

        let decision = coord.evaluate(account, 10_000, 10_000, 22_000, 0, 22_000, now);
        assert!(matches!(
            decision,
            Decision::Issue {
                up_to_seq: 22_000,
                shallow_start_seq: 10_000,
                ..
            }
        ));
    }

    #[test]
    fn issues_with_advancing_shallow_when_horizon_moves() {
        // Horizon advances past the existing shallow_start — new
        // shallow_start tracks horizon, advancing the compaction floor.
        let coord = SnapshotCoordinator::new();
        let account = Uuid::now_v7();
        let now = Instant::now();

        let decision = coord.evaluate(account, 10_000, 10_000, 22_000, 15_000, 22_000, now);
        assert!(matches!(
            decision,
            Decision::Issue {
                up_to_seq: 22_000,
                shallow_start_seq: 15_000,
                ..
            }
        ));
    }

    #[test]
    fn stale_completions_ignored() {
        let coord = SnapshotCoordinator::new();
        let account = Uuid::now_v7();
        let now = Instant::now();

        let result = coord.release(account, 100);
        assert!(
            matches!(result, ReleaseResult::Stale),
            "Stale result if coordinator does not track any snapshot"
        );

        coord.evaluate(account, 0, 0, 12_000, 12_000, 12_000, now);
        let result_2 = coord.release(account, 100);
        assert!(
            matches!(result_2, ReleaseResult::Stale),
            "Stale result if coordinator snapshot mismatch with client"
        );
    }
}
