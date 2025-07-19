use rand::Rng;
use std::cmp::Ordering;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static PID: OnceLock<u64> = OnceLock::new();

// Singleton, filled once, microsecond res clock
static CLOCK: MonotonicClock = MonotonicClock {
    last_micros: AtomicU64::new(0),
};

struct MonotonicClock {
    // thread-safe uint64, hardware handled op
    last_micros: AtomicU64,
}

impl MonotonicClock {
    fn now(&self) -> u64 {
        let system_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("SystemTime::now() failed")
            .as_micros() as u64;
        loop {
            // Acquire ensures we have seen all previous writes
            let last = self.last_micros.load(AtomicOrdering::Acquire);
            // Calc next time stamp
            let next = std::cmp::max(last + 1, system_time);
            // Update attempt, if failed try again
            // read, modify, write
            match self.last_micros.compare_exchange_weak(
                last,
                next,
                AtomicOrdering::Release, // Ensures other thread see write
                AtomicOrdering::Relaxed, // Just retry (cheap/who cares)
            ) {
                Ok(_) => return next,
                Err(_) => continue,
            }
        }
    }
}

// Public API
pub fn now_micros() -> u64 {
    CLOCK.now()
}

/// Generate a random process ID
pub fn gen_pid() -> u64 {
    rand::rng().random_range(1..=u64::MAX)
}

/// LWW timestamp for ordering operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LWWTimestamp {
    pub utc: u64, // Monotonic wall clock in microseconds
    pub pid: u64, // Process ID
}

impl LWWTimestamp {
    /// Create a new timestamp
    pub fn new(utc: Option<u64>, pid: Option<u64>) -> Self {
        let utc = utc.unwrap_or_else(|| now_micros());

        let static_pid = *PID.get_or_init(|| gen_pid());
        let pid = pid.unwrap_or(static_pid);

        Self { utc, pid }
    }
}

impl PartialOrd for LWWTimestamp {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for LWWTimestamp {
    fn cmp(&self, other: &Self) -> Ordering {
        match self.utc.cmp(&other.utc) {
            Ordering::Equal => self.pid.cmp(&other.pid),
            other_ordering => other_ordering,
        }
    }
}
