use std::time::Duration;

use mini_moka::sync::Cache;
use uuid::Uuid;

use crate::common::sql::Db;

type AuthCacheKey = (Uuid, Uuid);

#[derive(Clone)]
pub struct AuthCache {
    cache: Cache<AuthCacheKey, bool>,
}

// TODO: Revocation
// TODO: Shared library checks
impl AuthCache {
    pub fn new() -> Self {
        let cache = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(Duration::from_secs(60))
            .build();
        AuthCache { cache }
    }
    pub async fn check(&self, db: &Db, user_id: &Uuid, library_id: &Uuid) -> bool {
        let key = (user_id.clone(), library_id.clone());
        if let Some(val) = self.cache.get(&key) {
            return val;
        }
        // Fall through
        if let Some(user) = db.user.get_by_id(&user_id).await.unwrap() {
            if let Some(primary_library) = user.primary_library {
                if primary_library.id == *library_id {
                    self.cache.insert(key, true);
                    return true;
                }
            }
        };
        self.cache.insert(key, false);
        return false;
    }
}
