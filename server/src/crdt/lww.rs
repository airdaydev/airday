// TODO: This is a direct llm generated translation from the JS version, will need a thorough review

use rand::Rng;
use std::cmp::Ordering;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Generate a random process ID
pub fn gen_pid() -> u64 {
    rand::rng().random_range(0..u64::MAX)
}

/// LWW timestamp for ordering operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LWWTimestamp {
    pub utc: u64,  // Process wall clock in milliseconds
    pub pid: u64,  // Process ID
    pub tick: u64, // Process tick
}

impl LWWTimestamp {
    /// Create a new timestamp
    pub fn new(utc: Option<u64>, pid: u64, tick: Option<u64>) -> Self {
        let utc = utc.unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        });

        Self {
            utc,
            pid,
            tick: tick.unwrap_or(0),
        }
    }

    /// Check if this timestamp is greater than another
    pub fn greater_than(&self, other: &LWWTimestamp) -> bool {
        match self.utc.cmp(&other.utc) {
            Ordering::Greater => true,
            Ordering::Less => false,
            Ordering::Equal => match self.pid.cmp(&other.pid) {
                Ordering::Greater => true,
                Ordering::Less => false,
                Ordering::Equal => self.tick > other.tick,
            },
        }
    }
}

impl PartialOrd for LWWTimestamp {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for LWWTimestamp {
    fn cmp(&self, other: &Self) -> Ordering {
        if self.greater_than(other) {
            Ordering::Greater
        } else if other.greater_than(self) {
            Ordering::Less
        } else {
            Ordering::Equal
        }
    }
}

/// Thread-safe timestamp producer
pub struct TimestampProducer {
    pid: u64,
    last_utc: AtomicU64,
    tick: Mutex<u64>,
}

impl TimestampProducer {
    /// Create a new timestamp producer
    pub fn new(pid: Option<u64>) -> Self {
        Self {
            pid: pid.unwrap_or_else(gen_pid),
            last_utc: AtomicU64::new(0),
            tick: Mutex::new(0),
        }
    }

    /// Generate a new timestamp
    pub fn timestamp(&self) -> Result<LWWTimestamp, &'static str> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let last_utc = self.last_utc.load(AtomicOrdering::SeqCst);

        if now <= last_utc {
            // Need to increment tick for monotonic ordering
            let mut tick = self.tick.lock().unwrap();
            if *tick >= u64::MAX {
                return Err("Tick overflow - too many timestamps generated for the same UTC");
            }
            *tick += 1;

            Ok(LWWTimestamp {
                utc: last_utc,
                pid: self.pid,
                tick: *tick,
            })
        } else {
            // Update to new UTC time and reset tick
            self.last_utc.store(now, AtomicOrdering::SeqCst);
            let mut tick = self.tick.lock().unwrap();
            *tick = 0;

            Ok(LWWTimestamp {
                utc: now,
                pid: self.pid,
                tick: 0,
            })
        }
    }
}

lazy_static::lazy_static! {
    /// Global timestamp producer instance
    pub static ref GLOBAL_TS_PRODUCER: TimestampProducer = TimestampProducer::new(None);
}

/// Last-Write-Wins register
#[derive(Debug, Clone)]
pub struct LWWRegister<T> {
    pub timestamp: LWWTimestamp,
    pub data: T,
}

impl<T> LWWRegister<T> {
    /// Create a new LWW register
    pub fn new(data: T, timestamp: Option<LWWTimestamp>) -> Result<Self, &'static str> {
        let timestamp = match timestamp {
            Some(ts) => ts,
            None => GLOBAL_TS_PRODUCER.timestamp()?,
        };

        Ok(Self { timestamp, data })
    }

    /// Merge with another LWW register
    pub fn merge(self, other: Self) -> Result<Self, &'static str> {
        if self.timestamp == other.timestamp {
            return Err("Timestamp collision detected on merge");
        }

        if self.timestamp.greater_than(&other.timestamp) {
            Ok(self)
        } else {
            Ok(other)
        }
    }
}

/// Specialized LWW register for strings
#[derive(Debug, Clone)]
pub struct LWWRegisterString {
    pub timestamp: LWWTimestamp,
    pub data: String,
}

impl LWWRegisterString {
    /// Create a new string register
    pub fn new(data: String, timestamp: Option<LWWTimestamp>) -> Result<Self, &'static str> {
        let timestamp = match timestamp {
            Some(ts) => ts,
            None => GLOBAL_TS_PRODUCER.timestamp()?,
        };

        Ok(Self { timestamp, data })
    }

    /// Create from a string
    pub fn from_string(string: String) -> Result<Self, &'static str> {
        Self::new(string, None)
    }

    /// Merge with another string register
    pub fn merge(self, other: Self) -> Result<Self, &'static str> {
        if self.timestamp == other.timestamp {
            return Err("Timestamp collision detected on merge");
        }

        if self.timestamp.greater_than(&other.timestamp) {
            Ok(self)
        } else {
            Ok(other)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timestamp_ordering() {
        let ts1 = LWWTimestamp::new(Some(1000), 1, Some(0));
        let ts2 = LWWTimestamp::new(Some(1001), 1, Some(0));
        let ts3 = LWWTimestamp::new(Some(1000), 2, Some(0));
        let ts4 = LWWTimestamp::new(Some(1000), 1, Some(1));

        assert!(ts2.greater_than(&ts1)); // Higher UTC
        assert!(ts3.greater_than(&ts1)); // Same UTC, higher PID
        assert!(ts4.greater_than(&ts1)); // Same UTC and PID, higher tick
        assert!(!ts1.greater_than(&ts2));
    }

    #[test]
    fn test_timestamp_producer() {
        let producer = TimestampProducer::new(Some(123));
        let ts1 = producer.timestamp().unwrap();
        let ts2 = producer.timestamp().unwrap();

        assert!(ts2.greater_than(&ts1));
        assert_eq!(ts1.pid, 123);
        assert_eq!(ts2.pid, 123);
    }

    #[test]
    fn test_lww_register_merge() {
        let ts1 = LWWTimestamp::new(Some(1000), 1, Some(0));
        let ts2 = LWWTimestamp::new(Some(1001), 1, Some(0));

        let reg1 = LWWRegister::new("hello".to_string(), Some(ts1)).unwrap();
        let reg2 = LWWRegister::new("world".to_string(), Some(ts2)).unwrap();

        let merged = reg1.merge(reg2).unwrap();
        assert_eq!(merged.data, "world");
    }

    #[test]
    fn test_timestamp_collision_error() {
        let ts = LWWTimestamp::new(Some(1000), 1, Some(0));
        let reg1 = LWWRegister::new("hello".to_string(), Some(ts.clone())).unwrap();
        let reg2 = LWWRegister::new("world".to_string(), Some(ts)).unwrap();

        let result = reg1.merge(reg2);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Timestamp collision detected on merge");
    }
}
