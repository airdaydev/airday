// IndexedDB schema for the engine's op log — the web implementation of
// the Rust `LocalStorage` trait (`spec/local-storage-plan.md` Phase 2).
//
// This is a SEPARATE database from `airday-web` (vault + prefs +
// device + the now-defunct WAL/OPFS stores). Keeping it separate means
// the engine's data plane evolves on its own version line without
// racing the `airday-web` `onupgradeneeded` handler, and the cutover
// from the legacy WAL is a clean "fresh DB, nothing to migrate."
//
// The logical model mirrors `SqliteStorage` (CLI): one `docs` row per
// doc, an append-only `ops` log keyed by `(docId, localSeq)`, one
// `snapshots` row per doc. IDB's compound-index quirk — records where
// any key element is `undefined` are skipped — gives us the spec's
// partial-unique indexes for free (`clientOpId` is unset on remote
// rows, `serverSeq` is unset until ack).

export const ENGINE_DB_NAME = "airday-engine";
export const ENGINE_DB_VERSION = 1;

export const STORE_DOCS = "docs";
export const STORE_OPS = "ops";
export const STORE_SNAPSHOTS = "snapshots";
export const INDEX_OPS_CLIENT_OP_ID = "docIdClientOpId";
export const INDEX_OPS_SERVER_SEQ = "docIdServerSeq";

/** One row in the `ops` store. `clientOpId` (hex) is set on
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

let cached: Promise<IDBDatabase> | null = null;

/** Open (or return the cached) `airday-engine` database. A
 *  `versionchange` from a peer tab closes our handle and clears the
 *  cache so the next call re-opens. */
export function openEngineDb(): Promise<IDBDatabase> {
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
    const req = indexedDB.open(ENGINE_DB_NAME, ENGINE_DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) migrationV1(db);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("airday-engine open blocked by another tab"));
  });
}

function migrationV1(db: IDBDatabase): void {
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
}

/** Test-seam: forget the cached handle. Don't use in product code. */
export function _resetEngineDbForTests(): void {
  cached = null;
}
