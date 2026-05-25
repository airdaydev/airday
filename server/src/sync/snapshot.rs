use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use std::{collections::HashMap, sync::Mutex, time::Duration};
use uuid::Uuid;

// If we have 10k ops in our db - it's time to ask clients nicely to snapshot
// Timeout after 5 minutes
const SNAPSHOT_THRESHOLD_OPS: u64 = 10_000;
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
    threshold_ops: u64,
    leases: Arc<Mutex<HashMap<Uuid, LeaseState>>>,
    next_lease_id: Arc<AtomicU64>,
}

pub enum Decision {
    Issue { lease_id: u64, up_to_op_id: u64 },
    Skip,
}

pub enum ReleaseResult {
    Accepted,
    Stale, // covers both "wrong lease_id" and "no active lease"
}

impl SnapshotCoordinator {
    pub fn new() -> Self {
        Self::with_config(SNAPSHOT_THRESHOLD_OPS, SNAPSHOT_TIMEOUT)
    }

    pub fn with_config(threshold_ops: u64, timeout: Duration) -> Self {
        Self {
            timeout,
            threshold_ops,
            leases: Arc::new(Mutex::new(HashMap::new())),
            next_lease_id: Arc::new(AtomicU64::new(1)),
        }
    }
    pub fn evaluate(
        &self,
        account: Uuid,
        server_snapshot_op_id: u64,   // last snapshot's op id on server
        server_last_op_id: u64,       // latest op on server
        device_last_acked_op_id: u64, // last acked op on device
        now: Instant,
    ) -> Decision {
        // No need to snapshot yet
        if server_last_op_id.saturating_sub(server_snapshot_op_id) < self.threshold_ops {
            return Decision::Skip;
        }
        // Client is not yet up to date with server
        if server_last_op_id != device_last_acked_op_id {
            return Decision::Skip;
        }
        // Ok we are snapshot viable
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
        // Ok we're ready
        let lease_id = self.next_lease_id.fetch_add(1, Ordering::Relaxed);
        *lease_state = LeaseState::Active(ActiveLease {
            lease_id,
            expires_at: now + self.timeout,
        });
        Decision::Issue {
            lease_id,
            up_to_op_id: device_last_acked_op_id,
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

    #[test]
    fn issues_when_threshold_exceeded_and_caught_up() {
        let coord = SnapshotCoordinator::new();
        let account = Uuid::now_v7();
        let now = Instant::now();

        let decision = coord.evaluate(account, 5000, 12_000, 12_000, now);
        assert!(
            matches!(decision, Decision::Skip),
            "Fails within default threshold ops (10k)"
        );

        let decision = coord.evaluate(account, 0, 12_000, 11_999, now);
        assert!(
            matches!(decision, Decision::Skip),
            "Fails if client is behind server"
        );

        let decision = coord.evaluate(account, 0, 12_000, 12_000, now);

        assert!(matches!(
            decision,
            Decision::Issue {
                up_to_op_id: 12_000,
                ..
            }
        ));
        let Decision::Issue { lease_id, .. } = decision else {
            panic!("should issue")
        };

        let decision = coord.evaluate(account, 0, 22_000, 22_000, now);
        assert!(
            matches!(decision, Decision::Skip),
            "In-flight request; should fail"
        );

        let result = coord.release(account, lease_id);
        assert!(matches!(result, ReleaseResult::Accepted));

        // TODO: Issues after expiry?

        let decision_2 = coord.evaluate(account, 0, 22_000, 22_000, now);
        assert!(
            matches!(
                decision_2,
                Decision::Issue {
                    up_to_op_id: 22_000,
                    ..
                }
            ),
            "Issues instantly after completion again"
        );

        let decision = coord.evaluate(
            account,
            0,
            12_000,
            12_000,
            now + coord.timeout + Duration::from_secs(300),
        );
        assert!(
            matches!(
                decision,
                Decision::Issue {
                    up_to_op_id: 12_000,
                    ..
                }
            ),
            "Expired req, should issue"
        );
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

        coord.evaluate(account, 0, 12_000, 12_000, now);
        let result_2 = coord.release(account, 100);
        assert!(
            matches!(result_2, ReleaseResult::Stale),
            "Stale result if coordinator snapshot mismatch with client"
        );
    }
}
