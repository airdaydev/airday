use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use uuid::Uuid;

use crate::state::AppState;

use super::queries;

const SNAPSHOT_THRESHOLD_OPS: u64 = 10_000;
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Clone)]
pub struct SnapshotCoordinator {
    inner: Arc<Mutex<Inner>>,
    timeout: Duration,
    threshold_ops: u64,
}

#[derive(Default)]
struct Inner {
    next_attempt_id: u64,
    leases: HashMap<Uuid, LeaseState>,
}

enum LeaseState {
    Selecting { attempt_id: u64 },
    InFlight(InFlightLease),
}

#[derive(Clone)]
struct InFlightLease {
    attempt_id: u64,
    device_id: Uuid,
    trigger_op_id: u64,
    request_up_to_op_id: u64,
    tried_devices: HashSet<Uuid>,
}

struct SelectionReservation {
    attempt_id: u64,
    trigger_op_id: u64,
    tried_devices: HashSet<Uuid>,
}

pub(crate) struct Candidate {
    pub(crate) device_id: Uuid,
    pub(crate) sub_id: u64,
    pub(crate) last_acked_op_id: u64,
}

impl SnapshotCoordinator {
    pub fn new() -> Self {
        Self::with_settings(SNAPSHOT_TIMEOUT, SNAPSHOT_THRESHOLD_OPS)
    }

    pub fn with_timeout(timeout: Duration) -> Self {
        Self::with_settings(timeout, SNAPSHOT_THRESHOLD_OPS)
    }

    pub fn with_threshold(threshold_ops: u64) -> Self {
        Self::with_settings(SNAPSHOT_TIMEOUT, threshold_ops)
    }

    pub fn with_settings(timeout: Duration, threshold_ops: u64) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            timeout,
            threshold_ops,
        }
    }

    pub async fn on_ops_appended(&self, state: AppState, account_id: Uuid, latest_op_id: u64) {
        if let Some(reservation) = self.reserve_new_attempt(account_id, latest_op_id) {
            self.drive_selection(state, account_id, reservation).await;
        }
    }

    pub fn permits_snapshot(&self, account_id: Uuid, device_id: Uuid, up_to_op_id: u64) -> bool {
        let inner = self.inner.lock().unwrap();
        matches!(
            inner.leases.get(&account_id),
            Some(LeaseState::InFlight(in_flight))
                if in_flight.device_id == device_id
                    && up_to_op_id >= in_flight.request_up_to_op_id
        )
    }

    pub async fn on_snapshot_persisted(
        &self,
        state: AppState,
        account_id: Uuid,
        device_id: Uuid,
        up_to_op_id: u64,
    ) {
        self.clear_completed_snapshot(account_id, device_id, up_to_op_id);
        if let Ok(latest_op_id) = queries::latest_account_op_id(&state.db, account_id).await {
            if latest_op_id > 0 {
                self.on_ops_appended(state, account_id, latest_op_id).await;
            }
        }
    }

    pub async fn on_disconnect(&self, state: AppState, account_id: Uuid, device_id: Uuid) {
        let Some(reservation) = self.reserve_retry_for_device_disconnect(account_id, device_id)
        else {
            return;
        };
        self.drive_selection(state, account_id, reservation).await;
    }

    async fn on_timeout(&self, state: AppState, account_id: Uuid, attempt_id: u64) {
        let Some(reservation) = self.reserve_retry_for_timeout(account_id, attempt_id) else {
            return;
        };
        self.drive_selection(state, account_id, reservation).await;
    }

    fn reserve_new_attempt(
        &self,
        account_id: Uuid,
        latest_op_id: u64,
    ) -> Option<SelectionReservation> {
        let mut inner = self.inner.lock().unwrap();
        if inner.leases.contains_key(&account_id) {
            return None;
        }
        inner.next_attempt_id += 1;
        let attempt_id = inner.next_attempt_id;
        inner
            .leases
            .insert(account_id, LeaseState::Selecting { attempt_id });
        Some(SelectionReservation {
            attempt_id,
            trigger_op_id: latest_op_id,
            tried_devices: HashSet::new(),
        })
    }

    fn reserve_retry_for_device_disconnect(
        &self,
        account_id: Uuid,
        device_id: Uuid,
    ) -> Option<SelectionReservation> {
        let mut inner = self.inner.lock().unwrap();
        let lease = inner.leases.remove(&account_id)?;
        match lease {
            LeaseState::InFlight(in_flight) if in_flight.device_id == device_id => {
                inner.next_attempt_id += 1;
                let attempt_id = inner.next_attempt_id;
                let mut tried_devices = in_flight.tried_devices;
                tried_devices.insert(device_id);
                inner
                    .leases
                    .insert(account_id, LeaseState::Selecting { attempt_id });
                Some(SelectionReservation {
                    attempt_id,
                    trigger_op_id: in_flight.trigger_op_id,
                    tried_devices,
                })
            }
            other => {
                inner.leases.insert(account_id, other);
                None
            }
        }
    }

    fn reserve_retry_for_timeout(
        &self,
        account_id: Uuid,
        attempt_id: u64,
    ) -> Option<SelectionReservation> {
        let mut inner = self.inner.lock().unwrap();
        let lease = inner.leases.remove(&account_id)?;
        match lease {
            LeaseState::InFlight(in_flight) if in_flight.attempt_id == attempt_id => {
                inner.next_attempt_id += 1;
                let next_attempt_id = inner.next_attempt_id;
                let mut tried_devices = in_flight.tried_devices;
                tried_devices.insert(in_flight.device_id);
                inner.leases.insert(
                    account_id,
                    LeaseState::Selecting {
                        attempt_id: next_attempt_id,
                    },
                );
                Some(SelectionReservation {
                    attempt_id: next_attempt_id,
                    trigger_op_id: in_flight.trigger_op_id,
                    tried_devices,
                })
            }
            other => {
                inner.leases.insert(account_id, other);
                None
            }
        }
    }

    fn clear_selection_if_current(&self, account_id: Uuid, attempt_id: u64) {
        let mut inner = self.inner.lock().unwrap();
        let should_clear = matches!(
            inner.leases.get(&account_id),
            Some(LeaseState::Selecting { attempt_id: current_attempt_id })
                if *current_attempt_id == attempt_id
        );
        if should_clear {
            inner.leases.remove(&account_id);
        }
    }

    fn install_in_flight_lease(
        &self,
        account_id: Uuid,
        attempt_id: u64,
        trigger_op_id: u64,
        candidate: &Candidate,
        tried_devices: HashSet<Uuid>,
    ) -> bool {
        let mut inner = self.inner.lock().unwrap();
        match inner.leases.get(&account_id) {
            Some(LeaseState::Selecting {
                attempt_id: current_attempt_id,
            }) if *current_attempt_id == attempt_id => {}
            _ => return false,
        }
        inner.leases.insert(
            account_id,
            LeaseState::InFlight(InFlightLease {
                attempt_id,
                device_id: candidate.device_id,
                trigger_op_id,
                request_up_to_op_id: candidate.last_acked_op_id,
                tried_devices,
            }),
        );
        true
    }

    fn clear_completed_snapshot(&self, account_id: Uuid, device_id: Uuid, up_to_op_id: u64) {
        let mut inner = self.inner.lock().unwrap();
        let Some(lease) = inner.leases.remove(&account_id) else {
            return;
        };
        match lease {
            LeaseState::InFlight(in_flight)
                if in_flight.device_id == device_id
                    && up_to_op_id >= in_flight.request_up_to_op_id =>
            {
                let _ = in_flight;
            }
            other => {
                inner.leases.insert(account_id, other);
            }
        }
    }

    async fn drive_selection(
        &self,
        state: AppState,
        account_id: Uuid,
        reservation: SelectionReservation,
    ) {
        let latest_snapshot_floor = match queries::latest_snapshot_floor(&state.db, account_id)
            .await
        {
            Ok(floor) => floor.unwrap_or(0),
            Err(error) => {
                tracing::warn!(%account_id, error = %error, "snapshot lease selection failed reading latest snapshot");
                self.clear_selection_if_current(account_id, reservation.attempt_id);
                return;
            }
        };
        if reservation
            .trigger_op_id
            .saturating_sub(latest_snapshot_floor)
            <= self.threshold_ops
        {
            self.clear_selection_if_current(account_id, reservation.attempt_id);
            return;
        }

        let connected = state.sync_sessions.connected_subscribers(account_id);
        let candidate = match queries::snapshot_candidate(
            &state.db,
            account_id,
            &connected,
            &reservation.tried_devices,
            latest_snapshot_floor,
        )
        .await
        {
            Ok(candidate) => candidate,
            Err(error) => {
                tracing::warn!(%account_id, error = %error, "snapshot lease selection failed reading candidates");
                self.clear_selection_if_current(account_id, reservation.attempt_id);
                return;
            }
        };

        let Some(candidate) = candidate else {
            self.clear_selection_if_current(account_id, reservation.attempt_id);
            return;
        };

        if !state.sync_sessions.request_snapshot(
            account_id,
            candidate.sub_id,
            candidate.last_acked_op_id,
        ) {
            self.clear_selection_if_current(account_id, reservation.attempt_id);
            return;
        }

        let trigger_op_id = reservation.trigger_op_id;
        let mut tried_devices = reservation.tried_devices;
        tried_devices.insert(candidate.device_id);
        if !self.install_in_flight_lease(
            account_id,
            reservation.attempt_id,
            trigger_op_id,
            &candidate,
            tried_devices,
        ) {
            return;
        }

        self.spawn_timeout_task(state, account_id, reservation.attempt_id);
    }

    fn spawn_timeout_task(&self, state: AppState, account_id: Uuid, attempt_id: u64) {
        let coordinator = self.clone();
        let timeout = self.timeout;
        tokio::spawn(timeout_retry_task(
            coordinator,
            state,
            account_id,
            attempt_id,
            timeout,
        ));
    }
}

async fn timeout_retry_task(
    coordinator: SnapshotCoordinator,
    state: AppState,
    account_id: Uuid,
    attempt_id: u64,
    timeout: Duration,
) {
    tokio::time::sleep(timeout).await;
    coordinator.on_timeout(state, account_id, attempt_id).await;
}
