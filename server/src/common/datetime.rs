use chrono::{DateTime, Utc};
use serde::Serializer;

pub fn serialize_datetime_iso<S>(dt: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let s = dt.to_rfc3339();
    serializer.serialize_str(&s)
}
