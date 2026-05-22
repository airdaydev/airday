use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use std::{collections::HashMap, sync::Mutex, time::Duration};
use uuid::Uuid;

// If we have 10k ops in our db - it's time to ask clients nicely to snapshot
// Timeout after 5 minutes
const SNAPSHOT_THRESHOLD_OPS: u64 = 10_000;
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const SNAPSHOT_COOLDOWN: Duration = Duration::from_secs(5 * 60);

struct ActiveLease {
    lease_id: u64,
    device_id: Uuid,
    request_up_to_op_id: u64,
    expires_at: Instant,
}

enum LeaseState {
    Idle { cooldown_until: Option<Instant> },
    Active(ActiveLease),
}

#[derive(Clone)]
pub struct SnapshotCoordinator2 {
    timeout: Duration,  // Maximum time to allow device to return a snapshot
    cooldown: Duration, // Time between snapshot attempts
    threshold_ops: u64,
    leases: Arc<Mutex<HashMap<Uuid, LeaseState>>>,
    next_lease_id: Arc<AtomicU64>,
}

pub enum Decision {
    Issue {
        device_id: Uuid,
        lease_id: u64,
        up_to_op_id: u64,
    },
    Skip,
}

impl SnapshotCoordinator2 {
    pub fn new() -> Self {
        Self {
            timeout: SNAPSHOT_TIMEOUT,
            cooldown: SNAPSHOT_COOLDOWN,
            threshold_ops: SNAPSHOT_THRESHOLD_OPS,
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
        device_id: Uuid,
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
        let lease_state = leases.entry(account).or_insert_with(|| LeaseState::Idle {
            cooldown_until: None,
        });
        let expired = match lease_state {
            LeaseState::Active(lease) if now >= lease.expires_at => true, // Expired lease
            LeaseState::Active(_) => return Decision::Skip,               // In-flight lease
            LeaseState::Idle { .. } => false, // Could be idle, but not expired lease
        };
        if expired {
            // Prevent attempt for 5 minutes
            *lease_state = LeaseState::Idle {
                cooldown_until: Some(now + self.cooldown),
            };
            return Decision::Skip;
        }
        if let LeaseState::Idle { cooldown_until } = lease_state {
            let in_cooldown = match cooldown_until {
                None => false,
                Some(cooldown) => now < *cooldown,
            };
            if in_cooldown {
                return Decision::Skip;
            }
        }
        // Ok we're ready
        let lease_id = self.next_lease_id.fetch_add(1, Ordering::Relaxed);
        *lease_state = LeaseState::Active(ActiveLease {
            lease_id,
            device_id,
            request_up_to_op_id: device_last_acked_op_id,
            expires_at: now + self.timeout,
        });
        Decision::Issue {
            device_id,
            lease_id,
            up_to_op_id: device_last_acked_op_id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issues_when_threshold_exceeded_and_caught_up() {
        let coord = SnapshotCoordinator2::new();
        let account = Uuid::now_v7();
        let device = Uuid::now_v7();
        let now = Instant::now();

        let decision = coord.evaluate(account, 0, 12_000, 12_000, device, now);

        assert!(matches!(
            decision,
            Decision::Issue {
                up_to_op_id: 12_000,
                ..
            }
        ));
    }

    // TODO: Race these
}
