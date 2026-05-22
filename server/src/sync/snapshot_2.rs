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
    Idle {
        last_attempt_ended_at: Option<Instant>,
    },
    Active(ActiveLease),
}

struct SnapshotCoordinator2 {
    timeout: Duration,  // Maximum time to allow device to return a snapshot
    cooldown: Duration, // Time between snapshots
    threshold_ops: u64,
    leases: Mutex<HashMap<Uuid, LeaseState>>,
}

pub enum Decision {
  Issue { device_id: DeviceId, lease_id: u64, up_to_op_id: u64 },
  Skip,
}

impl SnapshotCoordinator2 {
    pub fn new() -> Self {
        Self {
            timeout: SNAPSHOT_TIMEOUT,
            threshold_ops: SNAPSHOT_THRESHOLD_OPS,
        }
    }
    pub fn evaluate(
      &self,
      account: Uuid,
      last_snapshot_up_to: u64, // local threshold
      device_id: Uuid,
      last_acked_op_id,
      now: Instant,
    ) -> Decision {
      let mut leases = self.leases.lock();
      let state = leases.entry(account).or_insert_with(|| LeaseState::Idle {
        last_attempt_ended_at: None });
      Decision::Skip
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_snapshot_attempt_when_threshold_exceeded() {
        let coordinator = SnapshotCoordinator2::new();
        coordinator.evaluate(Uuid::new(),
    }
}
