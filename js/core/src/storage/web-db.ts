// Shared IndexedDB schema for the web client.
//
// All persistent-at-rest browser state for airday lives in the
// `airday-web` database. Three modules write to it:
//
//   - `DekVault` (here)              — `vault`         store: wrapped DEK
//   - `IdbWalStorage` (here)         — `ops`           store: WAL rows
//                                    — `snapshot_meta` store: snapshot pointer
//                                    — `device`        store: device identity + sync frontier
//   - `prefs`    (in `@airday/web`)  — `prefs`         store: per-account UI preferences
//
// Splitting across multiple databases would mean racing
// `onupgradeneeded` handlers any time we evolve either schema, and
// would leave per-account state scattered across stores in different
// databases. This module is the single source of truth for the
// schema; callers go through `openAirdayDb()` so the upgrade path is
// declared once.

const DB_NAME = "airday-web";
// v5 = re-fire the v4 upgrade so any browser that opened the DB
// between the version-bump edit and the prefs-branch edit (and is
// therefore stuck at v4 *without* the prefs store) picks up the
// missing store. The upgrade body is fully idempotent — each
// `createObjectStore` is gated on `!contains(...)` — so re-running it
// at v5 only creates what's missing.
// v6 = re-key the per-doc data plane on `doc_id`: `ops` becomes
// `[doc_id, wal_seq]` and `snapshot_meta` becomes `doc_id`. Existing
// v5 stores carry `account_id`-keyed rows that can't be migrated in
// place (no doc_id on disk to migrate to), so the upgrade drops and
// recreates both. Pre-release; the only cost is that an existing dev
// must re-sync from the server (or re-mint an anonymous doc).
const DB_VERSION = 6;

export const STORE_VAULT = "vault";
export const STORE_OPS = "ops";
export const STORE_SNAPSHOT_META = "snapshot_meta";
export const STORE_DEVICE = "device";
export const STORE_PREFS = "prefs";
export const INDEX_OPS_BY_DOC_SEQ = "by_doc_seq";

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
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      // v1: vault. v2: ops + snapshot_meta. v3: device. v4: prefs
      // (initial). v5: re-fire to repair v4 DBs created before the
      // prefs upgrade branch existed. v6: drop+recreate ops and
      // snapshot_meta with doc_id keyPaths.
      //
      // Most blocks are additive + idempotent (`!contains` guard).
      // The v6 step is the exception — it deletes pre-existing stores
      // because IDB has no in-place keyPath migration.
      if (oldVersion < 6) {
        if (db.objectStoreNames.contains(STORE_OPS)) {
          db.deleteObjectStore(STORE_OPS);
        }
        if (db.objectStoreNames.contains(STORE_SNAPSHOT_META)) {
          db.deleteObjectStore(STORE_SNAPSHOT_META);
        }
      }
      if (!db.objectStoreNames.contains(STORE_VAULT)) {
        db.createObjectStore(STORE_VAULT);
      }
      if (!db.objectStoreNames.contains(STORE_OPS)) {
        const ops = db.createObjectStore(STORE_OPS, {
          keyPath: ["doc_id", "wal_seq"],
        });
        // Spec calls for an explicit `by_doc_seq` index even
        // though it duplicates the keyPath — keeps the door open
        // for future indexes (e.g. created_at) without renaming.
        ops.createIndex(INDEX_OPS_BY_DOC_SEQ, ["doc_id", "wal_seq"], {
          unique: true,
        });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOT_META)) {
        db.createObjectStore(STORE_SNAPSHOT_META, { keyPath: "doc_id" });
      }
      if (!db.objectStoreNames.contains(STORE_DEVICE)) {
        // Device config keyed per account — devices belong to accounts,
        // not docs (one account, possibly many docs). The device row
        // carries `primaryDocId` as a field so it points at the
        // account's Home doc without needing a separate lookup.
        db.createObjectStore(STORE_DEVICE, { keyPath: "account_id" });
      }
      if (!db.objectStoreNames.contains(STORE_PREFS)) {
        // UI preferences keyed per account, deliberately separate from
        // `device` so view-change writes don't churn the sync-frontier
        // row and vice versa.
        db.createObjectStore(STORE_PREFS, { keyPath: "account_id" });
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
