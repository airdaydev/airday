mod timestamp;
use crate::timestamp::LWWTimestamp;

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
            None => LWWTimestamp::new(None, None),
        };

        Ok(Self { timestamp, data })
    }

    /// Merge with another LWW register
    pub fn merge(self, other: Self) -> Result<Self, &'static str> {
        if self.timestamp == other.timestamp {
            return Err("Timestamp collision detected on merge");
        }

        if self.timestamp > other.timestamp {
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
            None => LWWTimestamp::new(None, None),
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

        if self.timestamp > other.timestamp {
            Ok(self)
        } else {
            Ok(other)
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

        let reg1 = LWWRegister::new("hello".to_string(), Some(ts1)).unwrap();
        let reg2 = LWWRegister::new("world".to_string(), Some(ts2)).unwrap();

        let merged = reg1.merge(reg2).unwrap();
        assert_eq!(merged.data, "world");
    }

    #[test]
    fn test_timestamp_collision_error() {
        let ts = LWWTimestamp::new(Some(1000), Some(1));
        let reg1 = LWWRegister::new("hello".to_string(), Some(ts.clone())).unwrap();
        let reg2 = LWWRegister::new("world".to_string(), Some(ts)).unwrap();

        let result = reg1.merge(reg2);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Timestamp collision detected on merge");
    }

    #[test]
    fn instant_understanding() {
        println!("Instant: {:?}", Instant::now());
        println!("SystemTime: {:?}", SystemTime::now());
    }
}
