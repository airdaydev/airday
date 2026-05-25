//! Sqlite reads/writes for the op stream and per-device frontier.

use airday_protocol::{EncryptedBlob, StoredOp};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::{now_millis, Db};

use super::sessions::ConnectedSubscriber;

/// Hard caps per `OpsBatch` frame from `spec/sync-protocol.md`. The
/// byte cap is the safety net; the count cap is the common one.
pub const MAX_OPS_PER_BATCH: usize = 500;
pub const MAX_BYTES_PER_BATCH: usize = 256 * 1024;

/// Append ops in a single transaction. Returns the server-assigned
/// monotonic ids in input order.
pub async fn insert_ops(
    db: &Db,
    account_id: Uuid,
    blobs: Vec<EncryptedBlob>,
) -> anyhow::Result<Vec<u64>> {
    let acc_bytes = account_id.as_bytes().to_vec();
    let now = now_millis();
    db.call(move |c| {
        let tx = c.transaction()?;
        let mut ids = Vec::with_capacity(blobs.len());
        {
            let mut stmt = tx.prepare(
                "INSERT INTO ops (account_id, payload, payload_nonce, created_at)
                 VALUES (?, ?, ?, ?)",
            )?;
            for blob in &blobs {
                stmt.execute(params![acc_bytes, blob.ciphertext, blob.nonce, now,])?;
                ids.push(tx.last_insert_rowid() as u64);
            }
        }
        tx.commit()?;
        Ok(ids)
    })
    .await
}

/// One batch's worth of ops with id > since_op_id, ordered ascending.
/// Caps at `MAX_OPS_PER_BATCH` or `MAX_BYTES_PER_BATCH`, whichever
/// trips first. `has_more` is true iff the caller should issue another
/// fetch from the last returned id.
pub struct FetchedBatch {
    pub ops: Vec<StoredOp>,
    pub has_more: bool,
}

pub async fn fetch_ops_batch(
    db: &Db,
    account_id: Uuid,
    since_op_id: u64,
) -> anyhow::Result<FetchedBatch> {
    let acc_bytes = account_id.as_bytes().to_vec();
    db.call(move |c| {
        // Pull at most one extra row past the count cap; if it exists,
        // we know there's more without having to issue a count query.
        let limit = (MAX_OPS_PER_BATCH + 1) as i64;
        let mut stmt = c.prepare(
            "SELECT id, payload, payload_nonce
             FROM ops
             WHERE account_id = ? AND id > ?
             ORDER BY id ASC
             LIMIT ?",
        )?;
        let rows = stmt.query_map(params![acc_bytes, since_op_id as i64, limit], |r| {
            Ok((
                r.get::<_, i64>(0)? as u64,
                r.get::<_, Vec<u8>>(1)?,
                r.get::<_, Vec<u8>>(2)?,
            ))
        })?;
        let mut ops = Vec::new();
        let mut bytes = 0usize;
        let mut over_count = false;
        let mut over_bytes = false;
        for row in rows {
            let (id, ciphertext, nonce) = row?;
            if ops.len() >= MAX_OPS_PER_BATCH {
                over_count = true;
                break;
            }
            let row_bytes = ciphertext.len() + nonce.len();
            if !ops.is_empty() && bytes + row_bytes > MAX_BYTES_PER_BATCH {
                over_bytes = true;
                break;
            }
            bytes += row_bytes;
            ops.push(StoredOp {
                id,
                blob: EncryptedBlob { nonce, ciphertext },
            });
        }
        Ok(FetchedBatch {
            ops,
            has_more: over_count || over_bytes,
        })
    })
    .await
}

/// Advance a device's frontier. Monotonic — silently ignores attempts
/// to move backwards so a slow client retransmitting old acks can't
/// corrupt the horizon calculation.
pub async fn advance_last_acked_op_id(
    db: &Db,
    device_id: Uuid,
    last_acked: u64,
) -> anyhow::Result<()> {
    let dev_bytes = device_id.as_bytes().to_vec();
    db.call(move |c| {
        c.execute(
            "UPDATE devices
             SET last_acked_op_id = ?
             WHERE id = ? AND last_acked_op_id < ?",
            params![last_acked as i64, dev_bytes, last_acked as i64],
        )
    })
    .await?;
    Ok(())
}

/// Latest snapshot for an account (highest `id`, which monotonically
/// tracks `up_to_op_id` since snapshots are append-only). Returns
/// `None` when no snapshot exists yet — the bootstrap path is dormant
/// in that case and `pull_ops` falls through to op streaming.
pub struct LatestSnapshot {
    pub up_to_op_id: u64,
    pub shallow_start_op_id: u64,
    pub blob: EncryptedBlob,
}

/// Just the two op-id columns of the latest snapshot, without the
/// payload. Hot path for `pull_ops` (compaction-floor check) and the
/// snapshot coordinator (trigger eval). `None` if no snapshot exists.
pub struct LatestSnapshotMeta {
    pub up_to_op_id: u64,
    pub shallow_start_op_id: u64,
}

/// Insert a snapshot row. Used by snapshot orchestration; integration
/// tests also call this directly to seed snapshot state.
pub async fn insert_snapshot(
    db: &Db,
    account_id: Uuid,
    up_to_op_id: u64,
    shallow_start_op_id: u64,
    blob: EncryptedBlob,
) -> anyhow::Result<u64> {
    let acc_bytes = account_id.as_bytes().to_vec();
    let now = now_millis();
    db.call(move |c| {
        c.execute(
            "INSERT INTO snapshots (account_id, up_to_op_id, shallow_start_op_id, payload, payload_nonce, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![
                acc_bytes,
                up_to_op_id as i64,
                shallow_start_op_id as i64,
                blob.ciphertext,
                blob.nonce,
                now,
            ],
        )?;
        Ok(c.last_insert_rowid() as u64)
    })
    .await
}

pub async fn latest_snapshot(db: &Db, account_id: Uuid) -> anyhow::Result<Option<LatestSnapshot>> {
    let acc_bytes = account_id.as_bytes().to_vec();
    db.call(move |c| {
        let row = c
            .query_row(
                "SELECT up_to_op_id, shallow_start_op_id, payload, payload_nonce
                 FROM snapshots
                 WHERE account_id = ?
                 ORDER BY id DESC
                 LIMIT 1",
                [acc_bytes],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)? as u64,
                        r.get::<_, i64>(1)? as u64,
                        r.get::<_, Vec<u8>>(2)?,
                        r.get::<_, Vec<u8>>(3)?,
                    ))
                },
            )
            .optional()?;
        Ok(
            row.map(
                |(up_to_op_id, shallow_start_op_id, ciphertext, nonce)| LatestSnapshot {
                    up_to_op_id,
                    shallow_start_op_id,
                    blob: EncryptedBlob { nonce, ciphertext },
                },
            ),
        )
    })
    .await
}

pub async fn latest_snapshot_meta(
    db: &Db,
    account_id: Uuid,
) -> anyhow::Result<Option<LatestSnapshotMeta>> {
    let acc_bytes = account_id.as_bytes().to_vec();
    db.call(move |c| {
        let row = c
            .query_row(
                "SELECT up_to_op_id, shallow_start_op_id
                 FROM snapshots
                 WHERE account_id = ?
                 ORDER BY id DESC
                 LIMIT 1",
                [acc_bytes],
                |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64)),
            )
            .optional()?;
        Ok(row.map(|(up_to_op_id, shallow_start_op_id)| LatestSnapshotMeta {
            up_to_op_id,
            shallow_start_op_id,
        }))
    })
    .await
}

/// Read a device's recorded frontier. Used by tests; production paths
/// just call `advance_last_acked_op_id`.
pub async fn get_last_acked_op_id(db: &Db, device_id: Uuid) -> anyhow::Result<u64> {
    let dev_bytes = device_id.as_bytes().to_vec();
    db.call(move |c| {
        c.query_row(
            "SELECT last_acked_op_id FROM devices WHERE id = ?",
            [dev_bytes],
            |r| r.get::<_, i64>(0),
        )
    })
    .await
    .map(|v| v as u64)
}

/// Horizon: `min(last_acked_op_id)` across all of an account's
/// devices, with `override_device_id`'s row replaced by
/// `override_value`. Used as the shallow-snapshot start frontier
/// (see `spec/sync-protocol.md` §"Snapshot orchestration") and
/// computed from the calling device's optimistic frontier:
/// during a push, the device has the just-assigned op ids locally
/// but hasn't sent the `Ack` yet, so its DB row would drag horizon
/// down artificially. Substituting the optimistic value reflects
/// the device's true frontier.
///
/// Returns 0 when the account has no devices — caller treats that
/// as "no compaction possible" via the trigger's horizon guard.
pub async fn account_horizon(
    db: &Db,
    account_id: Uuid,
    override_device_id: Uuid,
    override_value: u64,
) -> anyhow::Result<u64> {
    let acc_bytes = account_id.as_bytes().to_vec();
    let dev_bytes = override_device_id.as_bytes().to_vec();
    db.call(move |c| {
        let v: Option<i64> = c.query_row(
            "SELECT MIN(CASE WHEN id = ? THEN ? ELSE last_acked_op_id END)
             FROM devices WHERE account_id = ?",
            params![dev_bytes, override_value as i64, acc_bytes],
            |r| r.get::<_, Option<i64>>(0),
        )?;
        Ok(v.unwrap_or(0) as u64)
    })
    .await
}

/// Max snapshots retained per account after compaction (see
/// `spec/storage.md` §"Compaction"). Older snapshots are deleted.
pub const KEEP_SNAPSHOTS: u64 = 2;

pub struct CompactionStats {
    pub ops_deleted: u64,
    pub snapshots_deleted: u64,
}

/// Delete ops at or below the latest snapshot's `shallow_start_op_id`
/// and prune snapshots older than the `keep_snapshots` newest. The
/// snapshot read + both deletes run in one transaction so a concurrent
/// `insert_snapshot` can't shift the floor mid-deletion. Returns 0/0
/// when no snapshot exists yet.
pub async fn compact_account(
    db: &Db,
    account_id: Uuid,
    keep_snapshots: u64,
) -> anyhow::Result<CompactionStats> {
    let acc_bytes = account_id.as_bytes().to_vec();
    db.call(move |c| {
        let tx = c.transaction()?;
        let floor: Option<i64> = tx
            .query_row(
                "SELECT shallow_start_op_id
                 FROM snapshots
                 WHERE account_id = ?
                 ORDER BY id DESC
                 LIMIT 1",
                [&acc_bytes],
                |r| r.get::<_, i64>(0),
            )
            .optional()?;
        let Some(floor) = floor else {
            tx.commit()?;
            return Ok(CompactionStats {
                ops_deleted: 0,
                snapshots_deleted: 0,
            });
        };
        let ops_deleted = tx.execute(
            "DELETE FROM ops WHERE account_id = ? AND id <= ?",
            params![acc_bytes, floor],
        )? as u64;
        // Subquery returns NULL when fewer than keep_snapshots+1 rows
        // exist, so `id <= NULL` evaluates false and nothing is pruned.
        let snapshots_deleted = tx.execute(
            "DELETE FROM snapshots
             WHERE account_id = ?
               AND id <= (
                 SELECT id FROM snapshots
                 WHERE account_id = ?
                 ORDER BY id DESC
                 LIMIT 1 OFFSET ?
               )",
            params![acc_bytes, acc_bytes, keep_snapshots as i64],
        )? as u64;
        tx.commit()?;
        Ok(CompactionStats {
            ops_deleted,
            snapshots_deleted,
        })
    })
    .await
}

pub async fn latest_account_op_id(db: &Db, account_id: Uuid) -> anyhow::Result<u64> {
    let acc_bytes = account_id.as_bytes().to_vec();
    db.call(move |c| {
        let row = c
            .query_row(
                "SELECT id
                 FROM ops
                 WHERE account_id = ?
                 ORDER BY id DESC
                 LIMIT 1",
                [acc_bytes],
                |r| r.get::<_, i64>(0),
            )
            .optional()?;
        Ok(row.unwrap_or(0) as u64)
    })
    .await
}
