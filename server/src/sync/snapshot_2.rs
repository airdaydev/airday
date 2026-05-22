use std::{collections::HashMap, sync::Mutex, time::Duration};
use tokio::time::Instant;
use uuid::Uuid;

// If we have 10k ops in our db - it's time to ask clients nicely to snapshot
// Timeout after 5 minutes
const SNAPSHOT_THRESHOLD_OPS: u64 = 10_000;
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

struct ActiveLease {
    lease_id: u64, // increasing by 1?
    device_id: Uuid,
    request_up_to_op_id: u64,
    expires_at: Instant,
}

enum LeaseState {
    Idle { cooldown_until: Option<Instant> },
    Active(ActiveLease),
}

struct SnapshotCoordinator2 {
    timeout: Duration,  // Maximum time to allow device to return a snapshot
    cooldown: Duration, // Time between snapshot attempts
    threshold_ops: u64,
    leases: Mutex<HashMap<Uuid, LeaseState>>,
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
            cooldown: SNAPSHOT_TIMEOUT,
            threshold_ops: SNAPSHOT_THRESHOLD_OPS,
            leases: Mutex::new(HashMap::new()),
        }
    }
    pub fn evaluate(
        &self,
        account: Uuid,
        server_snapshot_op_id: u64,   // last snapshot on server
        server_last_op_id: u64,       // latest op on device
        device_last_acked_op_id: u64, // last acked op on device
        device_id: Uuid,
        now: Instant,
    ) -> Decision {
        // No need to snapshot yet
        if server_last_op_id - server_snapshot_op_id < self.threshold_ops {
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
                cooldown_until: Some(now + Duration::from_secs(5 * 60)),
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
        let lease_id = 0; // TODO: get next id
                          // Create lease
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
    fn ensure_snapshot_attempt_when_threshold_exceeded() {
        let coordinator = SnapshotCoordinator2::new();
        coordinator.evaluate(Uuid::new())
    }

    // TODO: Race these
}
