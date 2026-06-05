// Shared IndexedDB schema for the web client.
//
// All persistent-at-rest browser state for airday lives in the
// `airday-web` database. Two concerns write to it:
//
//   - `DekVault`  (here)             — `vault`  store: wrapped DEK
//   - `device-store` (here)          — `device` store: device identity + sync frontier
//   - `prefs`     (in `@airday/web`) — `prefs`  store: per-account UI preferences
//
// The engine op log (snapshots + ops) used to live here too, but moved
// to its own `airday-engine` database behind the `LocalStorage` trait
// (`spec/local-storage.md`). The old `ops` / `snapshot_meta`
// stores are dropped on upgrade; their data is abandoned, not drained.
//
// Splitting `vault` / `device` / `prefs` across multiple databases
// would mean racing `onupgradeneeded` handlers any time we evolve
// either schema, and would leave per-account state scattered. This
// module is the single source of truth for the schema; callers go
// through `openAirdayDb()` so the upgrade path is declared once.

const DB_NAME = "airday-web";
// v1–v6 built up (and re-keyed) `vault` / `ops` / `snapshot_meta` /
// `device` / `prefs`. v7 retires the engine data plane: `ops` and
// `snapshot_meta` moved to the `airday-engine` database, so they're
// deleted here. The surviving stores (`vault`, `device`, `prefs`) are
// created idempotently, so a DB at any prior version upgrades cleanly.
const DB_VERSION = 7;

export const STORE_VAULT = "vault";
export const STORE_DEVICE = "device";
export const STORE_PREFS = "prefs";

// Retired engine-data-plane stores, deleted on upgrade if present.
const LEGACY_STORES = ["ops", "snapshot_meta"];

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
      // Drop the retired engine-data-plane stores (now in
      // `airday-engine`). Idempotent — gated on `contains`.
      for (const name of LEGACY_STORES) {
        if (db.objectStoreNames.contains(name)) {
          db.deleteObjectStore(name);
        }
      }
      // Surviving stores, each created only if missing so a DB at any
      // prior version converges to the current shape.
      if (!db.objectStoreNames.contains(STORE_VAULT)) {
        db.createObjectStore(STORE_VAULT);
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
