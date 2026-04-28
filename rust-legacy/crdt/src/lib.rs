pub mod timestamp;
use crate::timestamp::LWWTimestamp;

/// Last-Write-Wins register
#[derive(Debug, Clone)]
pub struct LWWRegister<T> {
    pub timestamp: LWWTimestamp,
    pub data: T,
}

impl<T> LWWRegister<T> {
    /// Create a new LWW register
    pub fn new(data: T, timestamp: Option<LWWTimestamp>) -> Self {
        let timestamp = match timestamp {
            Some(ts) => ts,
            None => LWWTimestamp::new(None, None),
        };

        Self { timestamp, data }
    }
}

impl<T: PartialEq> LWWRegister<T> {
    /// Merge with another string register
    pub fn merge(self, other: Self) -> Self {
        if self.timestamp == other.timestamp && self.data != other.data {
            println!("WARNING: Same timestamp, different data");
            // TODO: ALERT RE. POSSIBLE SYSTEMIC ISSUE
            return self;
        }

        if self.timestamp > other.timestamp {
            self
        } else {
            other
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Instant, SystemTime};

    use super::*;

    #[test]
    fn test_timestamp_ordering() {
        let ts1 = LWWTimestamp::new(Some(1000), Some(1));
        let ts2 = LWWTimestamp::new(Some(1001), Some(1));
        let ts3 = LWWTimestamp::new(Some(1000), Some(2));
        let ts4 = LWWTimestamp::new(Some(1000), Some(1));

        assert!(ts2 > ts1); // Higher UTC
        assert!(ts3 > ts1); // Same UTC, higher PID
        assert!(ts4 == ts1); // Same shit
        assert!(!(ts1 > ts2));
    }

    #[test]
    fn test_lww_register_merge() {
        let ts1 = LWWTimestamp::new(Some(1000), Some(1));
        let ts2 = LWWTimestamp::new(Some(1001), Some(1));

        let reg1 = LWWRegister::new(String::from("hello"), Some(ts1));
        let reg2 = LWWRegister::new(String::from("world"), Some(ts2));

        let merged = reg1.merge(reg2);
        assert_eq!(merged.data, "world");
    }

    #[test]
    fn test_timestamp_collision() {
        let ts = LWWTimestamp::new(Some(1000), Some(1));
        let reg1 = LWWRegister::new(String::from("hello"), Some(ts.clone()));
        let reg2 = LWWRegister::new(String::from("world"), Some(ts));

        let result = reg1.merge(reg2);
        // No change
        assert_eq!(result.data, String::from("hello"));
    }

    #[test]
    fn instant_understanding() {
        println!("Instant: {:?}", Instant::now());
        println!("SystemTime: {:?}", SystemTime::now());
    }
}
