// The web client's IndexedDB schema — one database, every store.
//
// All persistent-at-rest browser state for airday lives in the single
// `airday-web` database. Two layers share it:
//
//   Config plane (small, stable):
//     - `vault`  store  — wrapped DEK            (`dek-vault.ts`)
//     - `device` store  — device identity + `lastSyncAt` (`device-store.ts`)
//     - `prefs`  store  — per-account UI preferences (`@airday/web`)
//
//   Engine data plane (high-churn op log) — the web implementation of
//   the Rust `LocalStorage` trait (`spec/local-storage.md`), consumed by
//   `idb-storage.ts`:
//     - `docs`      store — one row per doc; carries the resume cursor
//     - `ops`       store — append-only op log keyed `(docId, localSeq)`
//     - `snapshots` store — one compacted snapshot per doc
//
// The two layers can't share an IDB transaction across *databases*, so
// they live in one database here: a single version line, a single
// `onupgradeneeded`, and the option of an atomic write spanning both
// planes if we ever need it. This module is the single source of truth
// for the schema; every caller goes through `openAirdayDb()`.
//
// IDB's compound-index quirk — records where any key element is
// `undefined` are skipped — gives the engine `ops` store the spec's
// partial-unique indexes for free (`clientOpId` is unset on remote rows,
// `serverSeq` is unset until ack).

const DB_NAME = "airday-web";
// v1–v6 built up (and re-keyed) the config stores plus a now-defunct
// op-log-on-OPFS data plane (`ops` / `snapshot_meta`). v7 retired that
// data plane and briefly homed the engine op log in a *separate*
// `airday-engine` database. v8 collapses that split back in: the engine stores
// (`docs` / `ops` / `snapshots`) are created here, and `airday-engine`
// is abandoned (its op log is re-pulled from the server, matching the
// "abandon, not drain" convention). Note `ops` is reused as an engine
// store name — the legacy `ops` is dropped before the engine `ops` is
// created so any prior version converges to the current shape.
const DB_VERSION = 8;

// Config-plane stores.
export const STORE_VAULT = "vault";
export const STORE_DEVICE = "device";
export const STORE_PREFS = "prefs";

// Engine-data-plane stores + indexes.
export const STORE_DOCS = "docs";
export const STORE_OPS = "ops";
export const STORE_SNAPSHOTS = "snapshots";
export const INDEX_OPS_CLIENT_OP_ID = "docIdClientOpId";
export const INDEX_OPS_SERVER_SEQ = "docIdServerSeq";

// Pre-v7 oplog/OPFS stores, deleted on upgrade if present. `ops` is in
// this list *and* recreated below as an engine store — the delete runs
// first, so the legacy schema never survives into the engine store.
const LEGACY_STORES = ["snapshot_meta"];

// The retired separate engine database (v7 only). Deleted best-effort
// after the consolidated DB opens so it doesn't linger as an orphan.
const RETIRED_ENGINE_DB = "airday-engine";

/** One row in the engine `ops` store. `clientOpId` (hex) is set on
 *  local-origin rows; `serverSeq` is filled on ack (local) or at
 *  insert (remote). */
export interface OpRow {
  docId: string;
  localSeq: number;
  clientOpId?: string;
  serverSeq?: number;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  createdAt: number;
}

export interface SnapshotRow {
  docId: string;
  upToLocalSeq: number;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  createdAt: number;
}

/** One row in the `docs` store. `lastAckedServerSeq` is the persisted
 *  resume cursor — the highest *contiguous* serverSeq the engine has
 *  durably applied. Set explicitly via `writeAckedSeq` (never derived
 *  from `MAX(serverSeq)`, which over-shoots gaps and under-shoots after
 *  compaction). See `spec/local-storage.md`. */
export interface DocRow {
  id: string;
  createdAt: number;
  lastAckedServerSeq: number;
}

let cached: Promise<IDBDatabase> | null = null;
let cleanedUpRetiredDb = false;

/**
 * Open (or return the cached) `airday-web` database with every known
 * store materialised. The handle is shared across modules in the same
 * tab; a `versionchange` event from a peer tab triggering an upgrade
 * closes our handle and clears the cache so the next call opens a fresh
 * one.
 */
export function openAirdayDb(): Promise<IDBDatabase> {
  if (!cached) {
    cached = openOnce().then((db) => {
      db.onversionchange = () => {
        db.close();
        cached = null;
      };
      dropRetiredEngineDb();
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
      // Drop the retired pre-v7 oplog/OPFS stores. The legacy `ops` store
      // shares a name with the engine `ops` store created below, so it
      // MUST be deleted before the engine store is (re)created.
      for (const name of [...LEGACY_STORES, STORE_OPS]) {
        if (db.objectStoreNames.contains(name)) {
          db.deleteObjectStore(name);
        }
      }
      // Config-plane stores — each created only if missing so a DB at
      // any prior version converges to the current shape.
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
      // Engine-data-plane stores. The logical model mirrors
      // `SqliteStorage` (CLI): one `docs` row per doc, an append-only
      // `ops` log keyed by `(docId, localSeq)`, one `snapshots` row per
      // doc. `ops` is always created fresh here (the delete above
      // cleared any legacy store of the same name).
      db.createObjectStore(STORE_DOCS, { keyPath: "id" });
      const ops = db.createObjectStore(STORE_OPS, {
        keyPath: ["docId", "localSeq"],
      });
      // Partial-unique by IDB's undefined-skipping rule (see header):
      //   - clientOpId set on local rows only → uniqueness among them;
      //   - serverSeq set once acked → uniqueness among acked rows.
      ops.createIndex(INDEX_OPS_CLIENT_OP_ID, ["docId", "clientOpId"], {
        unique: true,
      });
      ops.createIndex(INDEX_OPS_SERVER_SEQ, ["docId", "serverSeq"], {
        unique: true,
      });
      db.createObjectStore(STORE_SNAPSHOTS, { keyPath: "docId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("airday-web open blocked by another tab"));
  });
}

/** Best-effort, once-per-session cleanup of the retired `airday-engine`
 *  database (the v7-only separate op-log DB, now folded into
 *  `airday-web`). Fire-and-forget: a peer tab on old code may block the
 *  delete, in which case it lands when that tab closes; either way boot
 *  never waits on it. */
function dropRetiredEngineDb(): void {
  if (cleanedUpRetiredDb) return;
  cleanedUpRetiredDb = true;
  try {
    indexedDB.deleteDatabase(RETIRED_ENGINE_DB);
  } catch {
    // Ignore — orphan DB is harmless, just untidy.
  }
}

/** Test-seam: forget the cached handle so a fresh `openAirdayDb`
 *  re-acquires it. Don't use in product code. */
export function _resetAirdayDbForTests(): void {
  cached = null;
}
