// Public contract for the local snapshot+WAL store described by
// `spec/idb-wal.md`. Two implementations: `IdbWalStorage` (real
// browser persistence over OPFS + IndexedDB) and `MemWalStorage`
// (in-memory, for headless tests). Both must round-trip the same
// snapshot/WAL semantics so a test that passes against the mem store
// is meaningful evidence about the IDB store.

import type { DeviceConfig } from "./adapter.ts";

/** Hard-coded for now — see `spec/idb-wal.md` "Snapshotting". */
export const SNAPSHOT_THRESHOLD = 1000;

/** One decrypted WAL entry, in `wal_seq` order. */
export interface WalEntry {
  walSeq: number;
  /** Plaintext Loro update bytes — feed back via `Doc.importWalUpdates`. */
  plaintext: Uint8Array;
}

/** Shape of a successful boot replay. */
export interface ReplayPayload {
  /** Decrypted snapshot bytes (the envelope `Doc.save()` produces),
   *  or null if no snapshot has been committed yet. */
  snapshot: Uint8Array | null;
  /** Decrypted WAL entries strictly after `snapshotWalSeq`. */
  walEntries: WalEntry[];
  /** Highest wal_seq covered by `snapshot`. 0 when no snapshot. */
  snapshotWalSeq: number;
  /** Device config piggy-backed onto the same boot transaction so
   *  the boot path doesn't pay another IDB round-trip just to fetch
   *  one tiny row. `undefined` means "the implementation didn't
   *  bother batching it, call `getDevice()` separately"; `null`
   *  means "looked, none found". */
  device?: import("./adapter.ts").DeviceConfig | null;
}

/**
 * Per-account snapshot+WAL store. Lifecycle:
 *
 *   1. `loadForReplay()` once at boot — returns the committed
 *      snapshot (if any) and every WAL row strictly after it.
 *   2. `appendWal(plaintext)` after each committed local mutation.
 *      Resolves when the row is durable; the returned `wal_seq` is
 *      monotonic within the account.
 *   3. `commitSnapshot(plaintext, snapshotWalSeq)` when
 *      `shouldSnapshot()` flips true (or on tab close). The metadata
 *      flip is the commit point — a partially-written snapshot file
 *      that doesn't end up referenced by metadata is ignored on next
 *      boot.
 *   4. `clear()` on logout-style teardown.
 *
 * Implementations must NOT delete WAL rows in this version (see
 * `spec/idb-wal.md` "WAL Retention").
 */
export interface WalStorage {
  loadForReplay(): Promise<ReplayPayload>;
  appendWal(plaintext: Uint8Array): Promise<number>;
  shouldSnapshot(): boolean;
  highestWalSeq(): number;
  commitSnapshot(plaintext: Uint8Array, snapshotWalSeq: number): Promise<void>;
  getDevice(): Promise<DeviceConfig | null>;
  putDevice(device: DeviceConfig): Promise<void>;
  clear(): Promise<void>;
}
