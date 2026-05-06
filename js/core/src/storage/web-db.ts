// Shared IndexedDB schema for the web client.
//
// All persistent-at-rest browser state for airday lives in the
// `airday-web` database. Two modules write to it:
//
//   - `dekVault` (in `@airday/web`)  — `vault`         store: wrapped DEK
//   - `IdbWalStorage` (here)         — `ops`           store: WAL rows
//                                    — `snapshot_meta` store: snapshot pointer
//                                    — `device`        store: device config
//
// Splitting across multiple databases would mean racing
// `onupgradeneeded` handlers any time we evolve either schema, and
// would leave per-account state scattered across stores in different
// databases. This module is the single source of truth for the
// schema; callers go through `openAirdayDb()` so the upgrade path is
// declared once.

const DB_NAME = "airday-web";
const DB_VERSION = 3;

export const STORE_VAULT = "vault";
export const STORE_OPS = "ops";
export const STORE_SNAPSHOT_META = "snapshot_meta";
export const STORE_DEVICE = "device";
export const INDEX_OPS_BY_ACCOUNT_SEQ = "by_account_seq";

let cached: Promise<IDBDatabase> | null = null;

/**
 * Open (or return the cached) `airday-web` database with every
 * known store materialised. The handle is shared across modules in
 * the same tab; a `versionchange` event from a peer tab triggering
 * an upgrade closes our handle and clears the cache so the next
 * call opens a fresh one.
 */
export function openAirdayDb(): Promise<IDBDatabase> {
  if (!cached) {
    cached = openOnce().then((db) => {
      db.onversionchange = () => {
        db.close();
        cached = null;
      };
      return db;
    });
  }
  return cached;
}

function openOnce(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v1: vault. v2: ops + snapshot_meta. v3: device. Upgrades are
      // additive and idempotent — newly-installed clients hit every
      // block in one open; existing clients gain the missing stores
      // without touching pre-existing rows.
      if (!db.objectStoreNames.contains(STORE_VAULT)) {
        db.createObjectStore(STORE_VAULT);
      }
      if (!db.objectStoreNames.contains(STORE_OPS)) {
        const ops = db.createObjectStore(STORE_OPS, {
          keyPath: ["account_id", "wal_seq"],
        });
        // Spec calls for an explicit `by_account_seq` index even
        // though it duplicates the keyPath — keeps the door open
        // for future indexes (e.g. created_at) without renaming.
        ops.createIndex(INDEX_OPS_BY_ACCOUNT_SEQ, ["account_id", "wal_seq"], {
          unique: true,
        });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOT_META)) {
        db.createObjectStore(STORE_SNAPSHOT_META, { keyPath: "account_id" });
      }
      if (!db.objectStoreNames.contains(STORE_DEVICE)) {
        // Device config keyed per account so multi-account web (if it
        // ever lands) doesn't collide; matches the snapshot_meta shape.
        db.createObjectStore(STORE_DEVICE, { keyPath: "account_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("airday-web open blocked by another tab"));
  });
}

/** Test-seam: forget the cached handle so a fresh `openAirdayDb`
 *  re-acquires it. Don't use in product code. */
export function _resetAirdayDbForTests(): void {
  cached = null;
}
