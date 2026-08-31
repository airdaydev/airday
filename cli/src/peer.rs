//! Per-process Loro peer id lease — see `spec/peer-id-plan.md`.
//!
//! Loro's safety rule: a fixed peer id is only safe under strict
//! single-ownership locking (two live docs on one peer mint duplicate
//! `(peer, counter)` op ids — unrecoverable corruption sqlite cannot
//! prevent, since it serialises writes, not semantics). The lease is a
//! kernel flock on `peer-<slot>.lock` in the profile dir: exclusive,
//! non-blocking, held via the `File` in [`PeerLease`] for the whole
//! process, released by the kernel on *any* exit path (including
//! `kill -9` and power loss — the lock is kernel state tied to the open
//! file description, never persisted). Slot 0 wins in the common case;
//! contention walks up to the first free slot, so version-vector width
//! is bounded by max historical concurrency, not invocation count.
//!
//! Lock files are zero-byte tokens and are **never unlinked**: deleting
//! a held lock file lets a second process lock a fresh inode under the
//! same name while the first still holds the old one. The slot → peer
//! id mapping lives in sqlite (`peer_slots`), not in the files.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;

use crate::storage::SqliteStorage;

#[derive(Debug, thiserror::Error)]
pub enum PeerError {
    #[error("peer lease: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Storage(#[from] airday_core::StorageError),
}

/// An exclusive claim on one peer slot. Commits made by a `Doc` booted
/// with `peer_id` are only safe while this lease is alive — keep it in
/// scope as long as the doc (dropping the `File` releases the flock).
pub struct PeerLease {
    pub peer_id: u64,
    pub slot: u32,
    _lock: File,
}

/// Claim the lowest free slot: flock scan over `peer-<slot>.lock` files
/// in `profile_dir`, then read-or-mint the slot's peer id from
/// `peer_slots`. Always succeeds absent I/O errors — the pool is
/// unbounded and slots are minted lazily, so in practice this creates
/// `peer-0.lock` once and reuses it forever.
pub fn claim(profile_dir: &Path, store: &SqliteStorage) -> Result<PeerLease, PeerError> {
    for slot in 0u32.. {
        let path = profile_dir.join(format!("peer-{slot}.lock"));
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(&path)?;
        match file.try_lock() {
            Ok(()) => {
                let peer_id = store.read_or_mint_peer_slot(slot, mint_peer_id())?;
                return Ok(PeerLease {
                    peer_id,
                    slot,
                    _lock: file,
                });
            }
            Err(TryLockError::WouldBlock) => continue,
            Err(TryLockError::Error(e)) => return Err(e.into()),
        }
    }
    unreachable!("slot scan only ends by returning")
}

/// Random peer id. Loro reserves `u64::MAX` (`set_peer_id` rejects it).
fn mint_peer_id() -> u64 {
    loop {
        let peer: u64 = rand::random();
        if peer != u64::MAX {
            return peer;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &Path) -> SqliteStorage {
        SqliteStorage::open(&dir.join("doc.sqlite")).unwrap()
    }

    /// flock contends across separate opens even within one process, so
    /// concurrent invocations are modelled by two live claims.
    #[test]
    fn concurrent_claims_get_distinct_slots_and_peers() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let a = claim(dir.path(), &store).unwrap();
        let b = claim(dir.path(), &store).unwrap();
        assert_eq!(a.slot, 0);
        assert_eq!(b.slot, 1);
        assert_ne!(a.peer_id, b.peer_id);
    }

    #[test]
    fn released_slot_is_reclaimed_with_the_same_peer() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(dir.path());
        let first = claim(dir.path(), &store).unwrap();
        let peer = first.peer_id;
        drop(first);
        let again = claim(dir.path(), &store).unwrap();
        assert_eq!(again.slot, 0);
        assert_eq!(again.peer_id, peer, "slot 0's peer id is stable");
    }
}
