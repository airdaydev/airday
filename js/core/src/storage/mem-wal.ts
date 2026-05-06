// In-memory `WalStorage` for headless tests. Mirrors
// `IdbWalStorage`'s public contract — same ordering rules, same
// commit-point semantics, same retention rule (no WAL deletion) —
// without any browser globals. Encryption still runs through the
// real `Dek` so the round-trip exercises the actual crypto path.

import type { Dek, EncryptedBlob } from "../../wasm/airday_core_web.js";
import type { DeviceConfig } from "./adapter.ts";
import {
  SNAPSHOT_THRESHOLD,
  type ReplayPayload,
  type WalEntry,
  type WalStorage,
} from "./wal-adapter.ts";

type EncryptedBlobCtor = new (
  nonce: Uint8Array,
  ciphertext: Uint8Array,
) => EncryptedBlob;

interface SealedRow {
  walSeq: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  createdAt: number;
}

interface SnapshotMeta {
  snapshotWalSeq: number;
  /** Encrypted snapshot bytes. */
  cipher: Uint8Array;
  committedAt: number;
}

/**
 * In-memory snapshot+WAL.
 *
 * The class is deliberately not exported as a generic `MemStorage`
 * replacement — it implements the WAL contract specifically. Use it
 * in tests where you want to exercise the snapshot+WAL replay path
 * without spinning up real OPFS/IDB.
 *
 * `forkForReboot()` returns a fresh instance pointing at the same
 * underlying state — simulating a tab close + reopen without the
 * in-memory cursors carrying over.
 */
export class MemWalStorage implements WalStorage {
  private readonly state: SharedState;
  private nextWalSeq = 1;
  private walSinceSnapshot = 0;
  private loaded = false;

  constructor(
    private readonly dek: Dek,
    private readonly EncryptedBlobCtor: EncryptedBlobCtor,
    /** Optional shared backing — pass when forking a reboot. */
    state?: SharedState,
  ) {
    this.state = state ?? {
      walRows: [],
      snapshot: null,
      device: null,
    };
  }

  /** Fresh instance over the same backing state — what a tab reopen
   *  looks like to the WAL store. The new instance must call
   *  `loadForReplay` like a real boot would. */
  forkForReboot(): MemWalStorage {
    return new MemWalStorage(this.dek, this.EncryptedBlobCtor, this.state);
  }

  async loadForReplay(): Promise<ReplayPayload> {
    let snapshot: Uint8Array | null = null;
    let snapshotWalSeq = 0;
    if (this.state.snapshot) {
      try {
        const meta = this.state.snapshot;
        const cipher = meta.cipher;
        if (cipher.byteLength >= 24) {
          const nonce = cipher.subarray(0, 24);
          const ciphertext = cipher.subarray(24);
          snapshot = this.dek.open(
            new this.EncryptedBlobCtor(nonce, ciphertext),
          );
          snapshotWalSeq = meta.snapshotWalSeq;
        }
      } catch {
        snapshot = null;
        snapshotWalSeq = 0;
      }
    }

    const tail = this.state.walRows.filter((r) => r.walSeq > snapshotWalSeq);
    const walEntries: WalEntry[] = tail.map((r) => ({
      walSeq: r.walSeq,
      plaintext: this.dek.open(
        new this.EncryptedBlobCtor(r.nonce, r.ciphertext),
      ),
    }));

    const lastSeq =
      walEntries.length > 0
        ? walEntries[walEntries.length - 1]!.walSeq
        : Math.max(snapshotWalSeq, lastWalSeq(this.state.walRows));
    this.nextWalSeq = lastSeq + 1;
    this.walSinceSnapshot = walEntries.length;
    this.loaded = true;

    return { snapshot, walEntries, snapshotWalSeq };
  }

  async appendWal(plaintext: Uint8Array): Promise<number> {
    if (!this.loaded) {
      throw new Error("MemWalStorage.appendWal before loadForReplay");
    }
    const walSeq = this.nextWalSeq++;
    const sealed = this.dek.seal(plaintext);
    this.state.walRows.push({
      walSeq,
      nonce: copy(sealed.nonce),
      ciphertext: copy(sealed.ciphertext),
      createdAt: Date.now(),
    });
    this.walSinceSnapshot += 1;
    return walSeq;
  }

  shouldSnapshot(): boolean {
    return this.walSinceSnapshot >= SNAPSHOT_THRESHOLD;
  }

  highestWalSeq(): number {
    return this.nextWalSeq - 1;
  }

  async commitSnapshot(
    plaintext: Uint8Array,
    snapshotWalSeq: number,
  ): Promise<void> {
    const sealed = this.dek.seal(plaintext);
    const cipher = new Uint8Array(sealed.nonce.length + sealed.ciphertext.length);
    cipher.set(sealed.nonce, 0);
    cipher.set(sealed.ciphertext, sealed.nonce.length);

    // Per spec "Atomicity Rule": the metadata flip is the commit
    // point. We emulate it as a single assignment — anything that
    // throws *before* this line leaves the previous snapshot
    // authoritative.
    this.state.snapshot = {
      snapshotWalSeq,
      cipher,
      committedAt: Date.now(),
    };
    this.walSinceSnapshot = Math.max(
      0,
      this.highestWalSeq() - snapshotWalSeq,
    );
  }

  async getDevice(): Promise<DeviceConfig | null> {
    return this.state.device ? { ...this.state.device } : null;
  }

  async putDevice(device: DeviceConfig): Promise<void> {
    this.state.device = { ...device };
  }

  async clear(): Promise<void> {
    this.state.walRows = [];
    this.state.snapshot = null;
    this.state.device = null;
    this.nextWalSeq = 1;
    this.walSinceSnapshot = 0;
    this.loaded = false;
  }

  // ---------- test inspection ----------

  /** Inspect raw WAL row count (encrypted). Tests use this to assert
   *  that retention is conservative (rows are not deleted). */
  rawWalRowCount(): number {
    return this.state.walRows.length;
  }

  /** True iff a snapshot has been committed. */
  hasSnapshot(): boolean {
    return this.state.snapshot !== null;
  }
}

interface SharedState {
  walRows: SealedRow[];
  snapshot: SnapshotMeta | null;
  device: DeviceConfig | null;
}

function lastWalSeq(rows: SealedRow[]): number {
  let max = 0;
  for (const r of rows) {
    if (r.walSeq > max) max = r.walSeq;
  }
  return max;
}

function copy(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}
