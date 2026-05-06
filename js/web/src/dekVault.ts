// Persistent web session vault.
//
// The DEK only ever lives in memory after login. Re-prompting for the
// password on every reload would require a fresh Argon2id run and is
// the wrong UX bar for this product, so we persist the DEK at rest —
// but never as plaintext. The DEK bytes are AES-GCM encrypted under a
// per-vault wrapping key that's generated `extractable: false` and
// stored in IndexedDB. A non-extractable CryptoKey can be used by the
// origin's pages to encrypt/decrypt but cannot be read back out, so a
// passive snapshot/exfil of IDB yields ciphertext the attacker cannot
// open. An XSS payload running while the page is open *can* call
// `crypto.subtle.decrypt` with the live key — that's the documented
// tradeoff.
//
// One record per origin keyed at `'current'`. Web is a single-account
// surface; logging in as a different account overwrites. The vault
// shares the `airday-web` IndexedDB database with the WAL store
// (`@airday/core/storage/idb-wal`); the schema is owned by
// `@airday/core/storage/web-db` so neither module's open path
// surprises the other with a missing object store.

import { Dek } from "@airday/core/wasm";
import { STORE_VAULT, openAirdayDb } from "@airday/core/storage/web-db";

const STORE = STORE_VAULT;
const KEY = "current";

export interface VaultedSession {
  /** Local-only sessions with no server account behind them. Email
   *  and deviceId are null in this mode. */
  anonymous: boolean;
  accountId: string;
  email: string | null;
  deviceId: string | null;
  dek: Dek;
}

interface VaultRecord {
  anonymous: boolean;
  accountId: string;
  email: string | null;
  deviceId: string | null;
  wrappingKey: CryptoKey;
  iv: Uint8Array;
  wrappedDek: Uint8Array;
}

export const dekVault = {
  async load(): Promise<VaultedSession | null> {
    let rec: VaultRecord | undefined;
    try {
      const db = await openAirdayDb();
      rec = await idbGet<VaultRecord>(db, STORE, KEY);
    } catch (e) {
      console.warn("dekVault.load: idb open/read failed:", e);
      return null;
    }
    if (!rec) return null;
    try {
      const dekBytes = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: copyToFreshBuffer(rec.iv) },
          rec.wrappingKey,
          copyToFreshBuffer(rec.wrappedDek),
        ),
      );
      const dek = Dek.fromHex(toHex(dekBytes));
      return {
        // Records written before anonymous mode landed have no flag;
        // they're authenticated by definition.
        anonymous: rec.anonymous ?? false,
        accountId: rec.accountId,
        email: rec.email ?? null,
        deviceId: rec.deviceId ?? null,
        dek,
      };
    } catch (e) {
      // Corrupt or tampered record — drop it so the next login can
      // write a fresh one.
      console.warn("dekVault.load: unwrap failed, clearing:", e);
      await this.clear();
      return null;
    }
  },

  async save(s: VaultedSession): Promise<void> {
    const wrappingKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false, // non-extractable: stays inside the browser's key store
      ["encrypt", "decrypt"],
    );
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const dekBytes = fromHex(s.dek.toHex());
    const wrappedDek = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        wrappingKey,
        dekBytes,
      ),
    );
    const rec: VaultRecord = {
      anonymous: s.anonymous,
      accountId: s.accountId,
      email: s.email,
      deviceId: s.deviceId,
      wrappingKey,
      iv,
      wrappedDek,
    };
    const db = await openAirdayDb();
    await idbPut(db, STORE, KEY, rec);
  },

  async clear(): Promise<void> {
    try {
      const db = await openAirdayDb();
      await idbDelete(db, STORE, KEY);
    } catch (e) {
      console.warn("dekVault.clear: idb delete failed:", e);
    }
  },
};

// ---------- IndexedDB helpers ----------

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length >>> 1));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/** Copy a Uint8Array into a fresh ArrayBuffer-backed Uint8Array. The
 *  WebCrypto `BufferSource` typedef rejects `Uint8Array<ArrayBufferLike>`
 *  (which IDB-roundtripped buffers carry), so we shake the SAB-aware
 *  marker off by copying. */
function copyToFreshBuffer(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}
