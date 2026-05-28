// Browser local snapshot + IndexedDB WAL.
//
// See `spec/idb-wal.md`. Two layers per doc:
//
//   - OPFS:  the encrypted full-state snapshot (file pointed at by
//            `snapshot_meta.snapshot_file`). Per-doc directory.
//   - IDB :  one row per local commit in the `ops` store (keyed by
//            `[doc_id, wal_seq]`); the authoritative commit pointer
//            in `snapshot_meta` (keyed by `doc_id`).
//
// Restore = load the snapshot pointed to by `snapshot_meta`, then
// replay every WAL row with `wal_seq > snapshot_wal_seq`. The
// snapshot metadata is the commit point — a snapshot file that
// exists on disk but isn't referenced by metadata is ignored.
//
// Storage of WAL rows uses one IDB transaction per append (no
// batching) so a tab close mid-burst still flushes the rows already
// queued.
//
// `accountId` is carried alongside `docId` only for the per-account
// `device` row (which holds the sync frontier + primary doc pointer).
// All per-doc data — ops, snapshot meta, OPFS files — is scoped by
// `docId` only, so adding shared docs later doesn't require a key
// migration.

import type { Dek, EncryptedBlob } from "../../wasm/airday_core_web.js";
import { normalizeDeviceConfig, type DeviceConfig } from "./adapter.ts";
import {
  SNAPSHOT_THRESHOLD,
  type ReplayPayload,
  type WalEntry,
  type WalStorage,
} from "./wal-adapter.ts";
import {
  STORE_DEVICE,
  STORE_OPS,
  STORE_SNAPSHOT_META,
  openAirdayDb,
} from "./web-db.ts";

const META_VERSION = 1;

type EncryptedBlobCtor = new (
  nonce: Uint8Array,
  ciphertext: Uint8Array,
) => EncryptedBlob;

interface WalRow {
  doc_id: string;
  wal_seq: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  created_at: number;
}

interface SnapshotMetaRow {
  version: number;
  doc_id: string;
  snapshot_file: string;
  /** Monotonic per-doc generation counter. Drives the filename so
   *  consecutive commits at the same `snapshot_wal_seq` (visibility-
   *  hidden flushes, signup seeding) write to distinct paths and never
   *  overwrite a currently-committed file in place. Absent on rows
   *  written by older builds; treat missing as 0. */
  snapshot_gen?: number;
  snapshot_wal_seq: number;
  snapshot_bytes: number;
  snapshot_sha256: Uint8Array;
  committed_at: number;
}

/** IDB row shape for the `device` store. The `account_id` field
 *  duplicates `device.accountId` so it can serve as the keyPath. */
interface DeviceRow {
  account_id: string;
  device: DeviceConfig;
}

/**
 * Per-doc snapshot+WAL store backed by OPFS + IndexedDB.
 *
 * Single-tab assumption: this class does *not* coordinate with peer
 * tabs. Wal_seq ordering is enforced by IDB primary-key constraints
 * — concurrent appends from a peer tab would collide and one would
 * fail rather than silently interleave. Cross-tab ownership is the
 * shared-worker spec's problem (`spec/shared-worker.md`).
 */
export class IdbWalStorage implements WalStorage {
  private nextWalSeq = 1;
  /** WAL rows appended since the snapshot pointed to by metadata. */
  private walSinceSnapshot = 0;
  private loaded = false;

  constructor(
    private readonly accountId: string,
    private readonly docId: string,
    private readonly dek: Dek,
    private readonly EncryptedBlobCtor: EncryptedBlobCtor,
  ) {}

  /**
   * Read the committed snapshot + every WAL row strictly after it.
   * Decrypts both layers. Must be called before `appendWal` so
   * `wal_seq` cursors are initialised.
   *
   * Performance shape:
   *   - one IDB readonly tx covers `snapshot_meta` + `ops`; we don't
   *     pay per-store transaction setup twice
   *   - `getAll(range)` pulls every WAL row in one event-loop trip,
   *     instead of N `cursor.continue()` round-trips that the cursor
   *     variant pays
   *   - WAL row decryption (CPU-bound, sync wasm) runs while the
   *     OPFS snapshot read (I/O-bound) is still in flight
   *   - sha256 verification fires off the hot path; a mismatch is
   *     logged but doesn't fail-stop boot
   */
  async loadForReplay(): Promise<ReplayPayload> {
    const db = await this.openDb();
    const { meta, rows, device } = await this.readMetaAndWal(db);

    const snapshotWalSeq = meta?.snapshot_wal_seq ?? 0;

    // Kick the OPFS file read off first so the disk read is in
    // flight while we decrypt the WAL tail synchronously below.
    const opfsCipherPromise: Promise<Uint8Array | null> = meta
      ? readOpfsFile(this.docId, meta.snapshot_file)
      : Promise.resolve(null);

    const tailRows = rows.filter((r) => r.wal_seq > snapshotWalSeq);
    const walEntries: WalEntry[] = tailRows.map((row) => ({
      walSeq: row.wal_seq,
      plaintext: this.dek.open(
        new this.EncryptedBlobCtor(row.nonce, row.ciphertext),
      ),
    }));

    let snapshot: Uint8Array | null = null;
    let effectiveSnapshotSeq = 0;
    if (meta) {
      const cipher = await opfsCipherPromise;
      if (cipher && cipher.byteLength >= 24) {
        if (cipher.byteLength === meta.snapshot_bytes) {
          void sha256(cipher).then((digest) => {
            if (!bytesEqual(new Uint8Array(digest), meta.snapshot_sha256)) {
              // eslint-disable-next-line no-console
              console.warn(
                `snapshot sha256 mismatch (file=${meta.snapshot_file}); ` +
                  `bytes loaded but integrity check failed`,
              );
            }
          });
        }
        const nonce = cipher.subarray(0, 24);
        const ciphertext = cipher.subarray(24);
        try {
          snapshot = this.dek.open(
            new this.EncryptedBlobCtor(nonce, ciphertext),
          );
          effectiveSnapshotSeq = meta.snapshot_wal_seq;
        } catch {
          // Decryption failure (wrong DEK / corrupt file) — fall
          // through to pure WAL replay. The walEntries list above
          // still includes only post-snapshot rows; if the snapshot
          // is unusable we want everything, so refresh the slice.
          snapshot = null;
          effectiveSnapshotSeq = 0;
        }
      }
    }

    // If snapshot decrypt failed but meta said there was a snapshot,
    // we already filtered out pre-snapshot rows. Re-derive walEntries
    // from the full row list in that uncommon path.
    let resultEntries = walEntries;
    if (!snapshot && snapshotWalSeq > 0) {
      resultEntries = rows.map((row) => ({
        walSeq: row.wal_seq,
        plaintext: this.dek.open(
          new this.EncryptedBlobCtor(row.nonce, row.ciphertext),
        ),
      }));
    }

    const lastSeq =
      resultEntries.length > 0
        ? resultEntries[resultEntries.length - 1]!.walSeq
        : effectiveSnapshotSeq;
    this.nextWalSeq = lastSeq + 1;
    this.walSinceSnapshot = resultEntries.length;
    this.loaded = true;

    return {
      snapshot,
      walEntries: resultEntries,
      snapshotWalSeq: effectiveSnapshotSeq,
      device,
    };
  }

  /**
   * Append one WAL row. Returns the assigned `wal_seq`. The row is
   * durable when the returned promise resolves — the IDB transaction
   * has committed.
   *
   * Concurrent calls within the same tab serialise on `nextWalSeq`;
   * each gets its own one-row transaction.
   */
  async appendWal(plaintext: Uint8Array): Promise<number> {
    if (!this.loaded) {
      throw new Error("IdbWalStorage.appendWal before loadForReplay");
    }
    const walSeq = this.nextWalSeq++;
    const sealed = this.dek.seal(plaintext);
    const row: WalRow = {
      doc_id: this.docId,
      wal_seq: walSeq,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      created_at: Date.now(),
    };
    const db = await this.openDb();
    await runTx(db, [STORE_OPS], "readwrite", (tx) => {
      tx.objectStore(STORE_OPS).put(row);
    });
    this.walSinceSnapshot += 1;
    return walSeq;
  }

  /** True when the WAL has accumulated enough rows to justify a fresh snapshot. */
  shouldSnapshot(): boolean {
    return this.walSinceSnapshot >= SNAPSHOT_THRESHOLD;
  }

  /** Latest assigned WAL sequence (0 before any append). */
  highestWalSeq(): number {
    return this.nextWalSeq - 1;
  }

  /**
   * Commit a fresh snapshot. The plaintext is the result of
   * `Doc.save()` (or `SyncEngine.save()`); we encrypt with the DEK,
   * write to a versioned OPFS file, then point committed metadata at
   * the new file.
   *
   * Metadata is the commit point: a successful OPFS write followed by
   * a crash leaves the previous metadata authoritative and the new
   * orphan file ignored on next boot.
   */
  async commitSnapshot(plaintext: Uint8Array, snapshotWalSeq: number): Promise<void> {
    const sealed = this.dek.seal(plaintext);
    const cipher = new Uint8Array(sealed.nonce.length + sealed.ciphertext.length);
    cipher.set(sealed.nonce, 0);
    cipher.set(sealed.ciphertext, sealed.nonce.length);

    const sha = new Uint8Array(await sha256(cipher));
    const db = await this.openDb();
    const previous = await this.getMeta(db);

    // Filename is derived from a monotonic `snapshot_gen`, never from
    // `snapshot_wal_seq`. Two commits at the same seq (visibility-
    // hidden re-fires, signup seeding) must land on distinct files so
    // the previously-committed file stays intact until the metadata
    // flip — see `spec/idb-wal.md` "Atomicity Rule". The `snap-`
    // namespace is fresh; any leftover `loro.bin` / `loro-N.bin` from
    // pre-`snapshot_gen` builds is reaped by the cleanup below on the
    // first commit after upgrade.
    const gen = (previous?.snapshot_gen ?? 0) + 1;
    const fileName = `snap-${gen}.bin`;
    await writeOpfsFile(this.docId, fileName, cipher);

    const next: SnapshotMetaRow = {
      version: META_VERSION,
      doc_id: this.docId,
      snapshot_file: fileName,
      snapshot_gen: gen,
      snapshot_wal_seq: snapshotWalSeq,
      snapshot_bytes: cipher.byteLength,
      snapshot_sha256: sha,
      committed_at: Date.now(),
    };
    await runTx(db, [STORE_SNAPSHOT_META], "readwrite", (tx) => {
      tx.objectStore(STORE_SNAPSHOT_META).put(next);
    });

    // After-commit cleanup — the previous snapshot file is now
    // orphaned. Best-effort; if it fails we leak the file but
    // correctness is unaffected (clear() reaps everything on logout).
    if (previous && previous.snapshot_file !== fileName) {
      void deleteOpfsFile(this.docId, previous.snapshot_file).catch(() => {});
    }

    // The WAL itself stays untouched — `spec/idb-wal.md` "WAL Retention"
    // forbids deletion until the sync-discharge frontier exists.
    this.walSinceSnapshot = Math.max(
      0,
      this.highestWalSeq() - snapshotWalSeq,
    );
  }

  // ---------- device config (IDB) ----------

  async getDevice(): Promise<DeviceConfig | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DEVICE, "readonly");
      const req = tx.objectStore(STORE_DEVICE).get(this.accountId);
      req.onsuccess = () => {
        const row = req.result as DeviceRow | undefined;
        resolve(normalizeDeviceConfig(row?.device));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async putDevice(device: DeviceConfig): Promise<void> {
    const db = await this.openDb();
    const row: DeviceRow = { account_id: this.accountId, device };
    await runTx(db, [STORE_DEVICE], "readwrite", (tx) => {
      tx.objectStore(STORE_DEVICE).put(row);
    });
  }

  // ---------- destructive ----------

  /** Drop every byte we own for this doc: OPFS snapshot files for
   *  this docId, IDB ops + snapshot_meta rows for this docId, and the
   *  per-account device row. */
  async clear(): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(this.docId, { recursive: true });
    } catch {
      // already gone
    }
    const db = await this.openDb();
    await runTx(
      db,
      [STORE_OPS, STORE_SNAPSHOT_META, STORE_DEVICE],
      "readwrite",
      (tx) => {
        const ops = tx.objectStore(STORE_OPS);
        const range = IDBKeyRange.bound(
          [this.docId, 0],
          [this.docId, Number.MAX_SAFE_INTEGER],
        );
        ops.delete(range);
        tx.objectStore(STORE_SNAPSHOT_META).delete(this.docId);
        tx.objectStore(STORE_DEVICE).delete(this.accountId);
      },
    );
    this.nextWalSeq = 1;
    this.walSinceSnapshot = 0;
    this.loaded = false;
  }

  // ---------- internals ----------

  private openDb(): Promise<IDBDatabase> {
    return openAirdayDb();
  }

  private async getMeta(db: IDBDatabase): Promise<SnapshotMetaRow | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOT_META, "readonly");
      const req = tx.objectStore(STORE_SNAPSHOT_META).get(this.docId);
      req.onsuccess = () => resolve((req.result as SnapshotMetaRow) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Single readonly transaction that reads `snapshot_meta`, the
   * full WAL row range, and the device row for this doc/account in
   * one go. `getAll` returns every match in one event-loop trip; the
   * cursor variant fired one `onsuccess` per row and was the
   * dominant cost on real IDB.
   *
   * The WAL range is keyed as `[docId, 0] .. [docId, MAX]`
   * so the read covers both pre- and post-snapshot rows; the caller
   * filters down to the post-snapshot tail once it knows
   * `snapshotWalSeq` from the meta row.
   */
  private async readMetaAndWal(db: IDBDatabase): Promise<{
    meta: SnapshotMetaRow | null;
    rows: WalRow[];
    device: DeviceConfig | null;
  }> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_SNAPSHOT_META, STORE_OPS, STORE_DEVICE],
        "readonly",
      );
      let meta: SnapshotMetaRow | null = null;
      let rows: WalRow[] = [];
      let device: DeviceConfig | null = null;
      const metaReq = tx.objectStore(STORE_SNAPSHOT_META).get(this.docId);
      metaReq.onsuccess = () => {
        meta = (metaReq.result as SnapshotMetaRow) ?? null;
      };
      const range = IDBKeyRange.bound(
        [this.docId, 0],
        [this.docId, Number.MAX_SAFE_INTEGER],
      );
      const opsReq = tx.objectStore(STORE_OPS).getAll(range);
      opsReq.onsuccess = () => {
        rows = (opsReq.result as WalRow[]) ?? [];
      };
      const deviceReq = tx.objectStore(STORE_DEVICE).get(this.accountId);
      deviceReq.onsuccess = () => {
        const row = deviceReq.result as DeviceRow | undefined;
        device = normalizeDeviceConfig(row?.device);
      };
      tx.oncomplete = () => resolve({ meta, rows, device });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("idb tx aborted"));
    });
  }
}

// ---------- IDB tx helper ----------

function runTx(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("idb tx aborted"));
    try {
      fn(tx);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        // already aborted — surface the original throw
      }
      reject(e);
    }
  });
}

// ---------- OPFS helpers ----------

async function opfsDocDir(
  docId: string,
): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(docId, { create: true });
}

async function readOpfsFile(
  docId: string,
  name: string,
): Promise<Uint8Array | null> {
  try {
    const dir = await opfsDocDir(docId);
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function writeOpfsFile(
  docId: string,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  const dir = await opfsDocDir(docId);
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  // Copy to a fresh ArrayBuffer (not SharedArrayBuffer-backed) so the
  // `FileSystemWritableFileStream` typing accepts it.
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  await w.write(buf);
  await w.close();
}

async function deleteOpfsFile(
  docId: string,
  name: string,
): Promise<void> {
  try {
    const dir = await opfsDocDir(docId);
    await dir.removeEntry(name);
  } catch (e) {
    if (isNotFound(e)) return;
    throw e;
  }
}

function isNotFound(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return (
    e.name === "NotFoundError" ||
    e.message.includes("not found") ||
    e.message.includes("does not exist")
  );
}

/** WebCrypto digest, but parameterised so the buffer source type is
 *  always a fresh ArrayBuffer — the lib types reject Uint8Array<ArrayBufferLike>. */
async function sha256(bytes: Uint8Array): Promise<ArrayBuffer> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return crypto.subtle.digest("SHA-256", buf);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
