// Web implementation of the Rust `LocalStorage` trait
// (`spec/local-storage.md`).
//
// The engine's trait is **synchronous** — `appendLocalOp` must return a
// `localSeq` immediately, `outbox()` must return rows immediately — but
// IndexedDB is async. We bridge the gap with an in-memory mirror of the
// op log: the synchronous methods read/write the mirror and return at
// once, while the underlying IDB write is queued onto a background
// flush chain. Real durability (the IDB transaction committing) is
// surfaced to the engine out-of-band via `whenFlushed()` → the host's
// `notifyOplogDurable`, so the server's `Ack` isn't shipped until the
// bytes are actually on disk.
//
// This object is handed to the wasm `SyncEngine` constructor as the
// `EngineStorage` — its method names line up with the extern interface
// declared in `core/web/src/lib.rs`. The wasm side passes encrypted
// payloads as `(ciphertext, nonce)` byte pairs and `clientOpId` as the
// raw 16 UUID bytes; everything stays opaque (the DEK never crosses
// this boundary — the engine seals/opens before/after).

import {
  type DocRow,
  type OpRow,
  openAirdayDb,
  type SnapshotRow,
  STORE_DOCS,
  STORE_OPS,
  STORE_SNAPSHOTS,
} from "./web-db.ts";

/** In-memory mirror row. `clientOpId` is hex (the IDB representation);
 *  `serverSeq` is unset until ack (local) / always set (remote). */
interface MirrorOp {
  localSeq: number;
  clientOpId?: string;
  serverSeq?: number;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  createdAt: number;
}

/** What the host needs to rebuild the `Doc` before constructing the
 *  engine: the snapshot (if any) and every op row strictly after it. */
export interface EngineBootRows {
  snapshot: { ciphertext: Uint8Array; nonce: Uint8Array } | null;
  replay: { ciphertext: Uint8Array; nonce: Uint8Array }[];
  /** Highest `localSeq` ever assigned (max of snapshot frontier and
   *  the op log) — seeds `engine.setLastLocalSeq`. */
  lastLocalSeq: number;
  /** Persisted resume cursor — the highest contiguous serverSeq the
   *  engine durably applied last session. Seeds `SyncEngine`'s
   *  `lastAckedSeq` (the `since_seq` of the resume `PullOps`). */
  lastAckedSeq: number;
}

/** One outbox row, in the shape the wasm extern reads back. */
export interface OutboxRowJs {
  localSeq: number;
  clientOpId: Uint8Array;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

// `writeSnapshot` cutoff kinds — must match the wasm bridge's mapping in
// `core/web/src/lib.rs` (`SnapshotCutoff`). Kind 0 is local-prefix (the
// else branch); kind 1 is server-frontier.
const CUTOFF_SERVER_FRONTIER = 1;

const HEX: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i]];
  return s;
}

// wasm-bindgen passes `&[u8]` args as a Uint8Array that is a *view*
// into wasm linear memory, valid only for the duration of the
// synchronous call. We retain these bytes (in the mirror and in a
// deferred IDB write), so we must copy them into a JS-owned buffer
// immediately — otherwise wasm reuses that memory and we persist
// garbage (which then fails to decrypt on the next boot).
function copyBytes(view: Uint8Array): Uint8Array {
  return view.slice();
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export class IdbStorage {
  private nextLocalSeq = 0;
  private snapshot: SnapshotRow | null = null;
  private ops: MirrorOp[] = [];
  private lastAckedServerSeq = 0;
  // Preserved across `writeAckedSeq` so updating the docs row doesn't
  // clobber the original creation time.
  private docCreatedAt = 0;
  // Background IDB writes are serialised through this chain so on-disk
  // order matches mirror order. Per-segment errors are logged and
  // swallowed to keep the chain alive (a poisoned chain would stall
  // every future write); `whenFlushed()` resolves once it settles.
  private flushChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly db: IDBDatabase,
    private readonly docId: string,
  ) {}

  /** Open the database, ensure the `docs` row, and load this doc's
   *  full op log + snapshot into the mirror. */
  static async open(docId: string): Promise<IdbStorage> {
    const db = await openAirdayDb();
    const storage = new IdbStorage(db, docId);
    await storage.load();
    return storage;
  }

  private load(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        [STORE_DOCS, STORE_OPS, STORE_SNAPSHOTS],
        "readwrite",
      );
      const docs = tx.objectStore(STORE_DOCS);
      const docGet = docs.get(this.docId);
      docGet.onsuccess = () => {
        if (!docGet.result) {
          docs.put({
            id: this.docId,
            createdAt: Date.now(),
            lastAckedServerSeq: 0,
          });
        }
      };
      const range = IDBKeyRange.bound(
        [this.docId, 0],
        [this.docId, Number.MAX_SAFE_INTEGER],
      );
      const opsReq = tx.objectStore(STORE_OPS).getAll(range);
      const snapReq = tx.objectStore(STORE_SNAPSHOTS).get(this.docId);
      tx.oncomplete = () => {
        const rows = (opsReq.result as OpRow[]) ?? [];
        this.ops = rows.map((r) => ({
          localSeq: r.localSeq,
          clientOpId: r.clientOpId,
          serverSeq: r.serverSeq,
          ciphertext: r.ciphertext,
          nonce: r.nonce,
          createdAt: r.createdAt,
        }));
        this.snapshot = (snapReq.result as SnapshotRow) ?? null;
        // `upToLocalSeq` is the snapshot's stored high-water, not a replay
        // cutoff — take the max with the surviving rows so a prune that
        // deleted the row carrying the old max doesn't reset the counter.
        const highWater = this.snapshot?.upToLocalSeq ?? 0;
        const maxOp = rows.reduce((m, r) => Math.max(m, r.localSeq), 0);
        this.nextLocalSeq = Math.max(highWater, maxOp);
        // Read the persisted resume cursor from the docs row — NOT
        // `MAX(serverSeq)` over the op log, which jumps past gaps and
        // drops after compaction (see `DocRow`). The engine is the
        // authority; we just replay what it last wrote.
        const docRow = docGet.result as DocRow | undefined;
        this.docCreatedAt = docRow?.createdAt ?? Date.now();
        this.lastAckedServerSeq = docRow?.lastAckedServerSeq ?? 0;
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("idb load aborted"));
    });
  }

  // ---------- host-facing (async) ----------

  /** Snapshot + post-snapshot replay rows for boot, plus the highest
   *  assigned `localSeq`. Read straight from the mirror loaded by
   *  `open()`. */
  bootRows(): EngineBootRows {
    // Replay every surviving row: `writeSnapshot` already pruned the rows
    // the snapshot contains. Pending and above-frontier rows can sit below
    // the high-water, so there's no `localSeq` cutoff to filter on here.
    const replay = this.ops
      .slice()
      .sort((a, b) => a.localSeq - b.localSeq)
      .map((o) => ({ ciphertext: o.ciphertext, nonce: o.nonce }));
    return {
      snapshot: this.snapshot
        ? { ciphertext: this.snapshot.ciphertext, nonce: this.snapshot.nonce }
        : null,
      replay,
      lastLocalSeq: this.nextLocalSeq,
      lastAckedSeq: this.lastAckedServerSeq,
    };
  }

  /** Resolves once every queued IDB write has settled. The host awaits
   *  this before `notifyOplogDurable` so the server is told "I have seq
   *  N" only after N's bytes are on disk. */
  whenFlushed(): Promise<void> {
    return this.flushChain;
  }

  // ---------- synchronous LocalStorage surface (called from wasm) ----------

  appendLocalOp(
    clientOpId: Uint8Array,
    ciphertext: Uint8Array,
    nonce: Uint8Array,
  ): number {
    const localSeq = ++this.nextLocalSeq;
    const row: OpRow = {
      docId: this.docId,
      localSeq,
      // `bytesToHex` reads synchronously, so it's safe on the transient
      // wasm view; ciphertext/nonce are retained (mirror + deferred IDB
      // write) so they MUST be copied — see `copyBytes`.
      clientOpId: bytesToHex(clientOpId),
      ciphertext: copyBytes(ciphertext),
      nonce: copyBytes(nonce),
      createdAt: Date.now(),
    };
    this.ops.push(toMirror(row));
    this.enqueuePut(STORE_OPS, row);
    return localSeq;
  }

  appendRemoteOp(
    serverSeq: number,
    ciphertext: Uint8Array,
    nonce: Uint8Array,
  ): number {
    // Idempotent: a re-delivered serverSeq (resume re-pull, broadcast
    // overlap) is already stored — return its localSeq rather than
    // minting a phantom row.
    const existing = this.ops.find((o) => o.serverSeq === serverSeq);
    if (existing) return existing.localSeq;
    const localSeq = ++this.nextLocalSeq;
    // Appending does NOT advance the resume cursor — that's
    // `writeAckedSeq`'s job (an op above a gap would jump it past the
    // hole). Mirrors `core::MemStorage` / `SqliteStorage`.
    const row: OpRow = {
      docId: this.docId,
      localSeq,
      serverSeq,
      ciphertext: copyBytes(ciphertext),
      nonce: copyBytes(nonce),
      createdAt: Date.now(),
    };
    this.ops.push(toMirror(row));
    this.enqueuePut(STORE_OPS, row);
    return localSeq;
  }

  ackLocalOp(clientOpId: Uint8Array, serverSeq: number): void {
    const hex = bytesToHex(clientOpId);
    const op = this.ops.find((o) => o.clientOpId === hex);
    if (!op) throw new Error(`ackLocalOp: unknown clientOpId ${hex}`);
    op.serverSeq = serverSeq;
    // As in `appendRemoteOp`: stamping a serverSeq doesn't move the
    // resume cursor — only `writeAckedSeq` does.
    this.enqueuePut(STORE_OPS, mirrorToRow(op, this.docId));
  }

  outbox(): OutboxRowJs[] {
    return this.ops
      .filter((o) => o.clientOpId != null && o.serverSeq == null)
      .sort((a, b) => a.localSeq - b.localSeq)
      .map((o) => ({
        localSeq: o.localSeq,
        clientOpId: hexToBytes(o.clientOpId as string),
        ciphertext: o.ciphertext,
        nonce: o.nonce,
      }));
  }

  writeSnapshot(
    cutoffKind: number,
    cutoff: number,
    ciphertext: Uint8Array,
    nonce: Uint8Array,
  ): void {
    // High-water is the local counter, not the cutoff — pruning may
    // delete the row carrying the current max localSeq, so stamp the
    // counter to keep future appends monotonic.
    this.snapshot = {
      docId: this.docId,
      upToLocalSeq: this.nextLocalSeq,
      ciphertext: copyBytes(ciphertext),
      nonce: copyBytes(nonce),
      createdAt: Date.now(),
    };
    // Server-frontier: drop confirmed rows the snapshot contains, keep
    // pending (no serverSeq) and above-frontier rows. Local-prefix: drop
    // the whole localSeq prefix (local-only docs that never sync).
    const survives = (o: MirrorOp): boolean =>
      cutoffKind === CUTOFF_SERVER_FRONTIER
        ? o.serverSeq == null || o.serverSeq > cutoff
        : o.localSeq > cutoff;
    const pruned = this.ops.filter((o) => !survives(o));
    this.ops = this.ops.filter(survives);
    const snap = this.snapshot;
    const docId = this.docId;
    this.enqueue([STORE_OPS, STORE_SNAPSHOTS], (tx) => {
      tx.objectStore(STORE_SNAPSHOTS).put(snap);
      // Delete pruned rows by primary key — the pruned set isn't a
      // contiguous localSeq range under a server-frontier cutoff.
      const ops = tx.objectStore(STORE_OPS);
      for (const o of pruned) ops.delete([docId, o.localSeq]);
    });
  }

  writeAckedSeq(serverSeq: number): void {
    this.lastAckedServerSeq = serverSeq;
    const row: DocRow = {
      id: this.docId,
      createdAt: this.docCreatedAt,
      lastAckedServerSeq: serverSeq,
    };
    this.enqueuePut(STORE_DOCS, row);
  }

  // ---------- IDB flush plumbing ----------

  private enqueuePut(store: string, value: unknown): void {
    this.enqueue([store], (tx) => {
      tx.objectStore(store).put(value);
    });
  }

  private enqueue(
    stores: string[],
    body: (tx: IDBTransaction) => void,
  ): void {
    this.flushChain = this.flushChain
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            const tx = this.db.transaction(stores, "readwrite");
            body(tx);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error("idb tx aborted"));
          }),
      )
      .catch((e) => {
        console.error("[idb-storage] flush failed:", e);
      });
  }
}

function toMirror(row: OpRow): MirrorOp {
  return {
    localSeq: row.localSeq,
    clientOpId: row.clientOpId,
    serverSeq: row.serverSeq,
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    createdAt: row.createdAt,
  };
}

function mirrorToRow(op: MirrorOp, docId: string): OpRow {
  return {
    docId,
    localSeq: op.localSeq,
    clientOpId: op.clientOpId,
    serverSeq: op.serverSeq,
    ciphertext: op.ciphertext,
    nonce: op.nonce,
    createdAt: op.createdAt,
  };
}
