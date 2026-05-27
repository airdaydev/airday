// Local WAL persistence pump around a sans-IO `SyncEngine`. Owned by
// the JS host (not the wasm core) so each platform — web today, future
// shared-worker / desktop — drives the same engine with the same
// snapshot+WAL semantics by swapping only the underlying `WalStorage`
// implementation.
//
// Two responsibilities, both spelled out in `spec/idb-wal.md`:
//
//   1. After every committed mutation (local or remote), capture the
//      engine delta since the previous capture, encrypt it, and append
//      a row to the WAL store. Appends are serialised through a
//      single promise chain so wal_seq ordering matches commit order.
//   2. When the WAL has accumulated `SNAPSHOT_THRESHOLD` rows since
//      the last snapshot, schedule a snapshot commit. Hosts can also
//      force one (tab-close, suspend) via `snapshotNow()`. We drain
//      the append chain first so the `snapshot_wal_seq` we record
//      actually covers every appended row.
//
// Boot replay (load the committed snapshot + replay every WAL row
// strictly after it) lives in the `bootWal` helper below.

import type { Doc, SyncEngine } from "../wasm/airday_core_web.js";
import type { DeviceConfig } from "./storage/adapter.ts";
import type { WalStorage } from "./storage/wal-adapter.ts";

export interface WalBridgeOpts {
  engine: SyncEngine;
  wal: WalStorage;
  /** Starting VV cursor for `exportUpdatesAfter`. Two shapes:
   *   - Fresh signup: pass `new Uint8Array(0)` so the first capture
   *     emits the seeded built-ins as `wal_seq = 1` (per spec/idb-wal.md
   *     "Fresh Account"). The engine's `Doc.create()` runs before the
   *     bridge is built, so the seeded ops are already in the oplog.
   *   - Replay-restored boot: pass `engine.oplogVvBytes()` so the
   *     cursor begins at the replay frontier — captures only the new
   *     ops added after restore, never re-emits replayed rows. */
  initialCursor: Uint8Array;
  /** Async error sink. Default: `console.error`. */
  onError?: (where: "appendWal" | "snapshot", err: unknown) => void;
  /** Runs after every successful `commitSnapshot` (both
   *  threshold-triggered and host-forced via `snapshotNow`). Hosts use
   *  this to piggy-back per-account writes (e.g. `wal.putDevice`) on
   *  the same cadence as snapshots. Awaited inside the snapshot
   *  pipeline — keep it short. Errors flow through `onError` as
   *  `"snapshot"`. */
  afterSnapshot?: () => Promise<void> | void;
  /** Fires after each successful `notifyWalDurable` call on the
   *  engine — i.e. once the WAL row covering a sampled seq is
   *  committed AND the engine has had a chance to queue the
   *  corresponding `Ack` frame. Hosts wire this to
   *  `SyncBridge.pumpOutbox` so the queued ack actually leaves the
   *  socket. Without it the ack waits for the next incoming server
   *  frame (or local mutation) to incidentally trigger a pump. */
  onDurable?: () => void;
}

/**
 * Per-session WAL pump. One bridge per `SyncEngine` per session.
 *
 * Threading: every method is sync-call-safe from a single tab. The
 * promise chains (`appendChain`, `snapshotChain`) serialise IO so
 * the host doesn't need its own queueing.
 */
export class WalBridge {
  private cursor: Uint8Array;
  private appendChain: Promise<void> = Promise.resolve();
  private snapshotChain: Promise<void> = Promise.resolve();
  private snapshotPending = false;

  constructor(private readonly opts: WalBridgeOpts) {
    this.cursor = opts.initialCursor;
  }

  /**
   * Capture engine ops since the previous cursor and queue an
   * encrypted append. Cheap no-op for the bytes path when nothing
   * changed (export returns 0 bytes), but the zero-bytes case still
   * chains a `notifyWalDurable` so an `OpsAck`-only server frame
   * (which doesn't add to the doc) still ratchets the durable
   * cursor forward — its bytes were already exported on the local
   * mutation that produced them. Call after every local commit AND
   * after every server frame the engine applies.
   *
   * Ordering: `lastContiguousSeq` is sampled **synchronously** at
   * call time, before any await. The `notifyWalDurable(sample)`
   * fires only after the prior chain entries (including the
   * `appendWal` that durably persisted those bytes) have resolved —
   * the FIFO appendChain is what binds the notify to actual
   * durability.
   */
  captureAndAppend(): void {
    const engine = this.opts.engine;
    const updates = engine.exportUpdatesAfter(this.cursor);
    // Sample BEFORE awaiting anything — captures the seq that is
    // covered by the bytes we're about to persist (or, in the
    // zero-bytes case, the seq we already persisted earlier).
    const sampledSeq = engine.lastContiguousSeq();
    if (updates.length === 0) {
      this.appendChain = this.appendChain
        .then(() => {
          engine.notifyWalDurable(sampledSeq);
          this.opts.onDurable?.();
        })
        .catch((e) => this.reportError("appendWal", e));
      return;
    }
    this.cursor = engine.oplogVvBytes();
    const wal = this.opts.wal;
    this.appendChain = this.appendChain
      .then(() => wal.appendWal(updates))
      .then(() => {
        engine.notifyWalDurable(sampledSeq);
        this.opts.onDurable?.();
        if (wal.shouldSnapshot()) this.scheduleSnapshot();
      })
      .catch((e) => this.reportError("appendWal", e));
  }

  /**
   * Force a snapshot now. Drains the append chain first so the
   * recorded `snapshot_wal_seq` covers every queued row. Hosts wire
   * this to platform suspend hooks (browser `visibilitychange` →
   * hidden, native app background).
   */
  async snapshotNow(): Promise<void> {
    this.snapshotPending = false;
    try {
      await this.appendChain;
      // Sample just before `save()` — captures the in-memory frontier
      // the snapshot encodes. A successful `commitSnapshot` makes
      // every applied seq up to here durable on disk, even ones whose
      // `appendWal` row was still in flight at the moment of capture.
      const sampledSeq = this.opts.engine.lastContiguousSeq();
      const bytes = this.opts.engine.save();
      const seq = this.opts.wal.highestWalSeq();
      await this.opts.wal.commitSnapshot(bytes, seq);
      this.opts.engine.notifyWalDurable(sampledSeq);
      this.opts.onDurable?.();
      if (this.opts.afterSnapshot) await this.opts.afterSnapshot();
    } catch (e) {
      this.reportError("snapshot", e);
    }
  }

  /** Resolves once in-flight appends and snapshots have settled.
   *  Useful in tests; production code rarely needs to await this. */
  async drain(): Promise<void> {
    await this.appendChain;
    await this.snapshotChain;
  }

  private scheduleSnapshot(): void {
    if (this.snapshotPending) return;
    this.snapshotPending = true;
    this.snapshotChain = this.snapshotChain.then(() => this.snapshotNow());
  }

  private reportError(where: "appendWal" | "snapshot", err: unknown): void {
    if (this.opts.onError) {
      this.opts.onError(where, err);
    } else {
      // eslint-disable-next-line no-console
      console.error(`wal ${where} failed:`, err);
    }
  }
}

export interface BootWalOpts {
  wal: WalStorage;
  /** Construct an empty Doc — wired from `Doc.empty`. */
  emptyDoc: () => Doc;
  /** Construct a Doc from a committed snapshot — wired from `Doc.load`. */
  loadDoc: (snapshot: Uint8Array) => Doc;
}

export interface BootWalResult {
  /** Doc with the committed snapshot (if any) and every WAL row
   *  strictly after `snapshotWalSeq` already applied. */
  doc: Doc;
  /** Highest `wal_seq` covered by the loaded snapshot. 0 if no
   *  snapshot was committed. */
  snapshotWalSeq: number;
  /** Device row read from the same boot transaction as the WAL. */
  device: DeviceConfig | null;
  /** WAL entries that failed to replay (e.g. corrupt row). The
   *  remaining entries still applied; the host can decide whether
   *  to log, fail-stop, or carry on. */
  replayErrors: { walSeq: number; error: unknown }[];
}

/**
 * Boot-time restore: load the committed snapshot, then replay every
 * WAL row strictly after it. Returns a Doc ready to hand to a
 * `SyncEngine`. The replay path tags imports as "remote" so the
 * rebuilt UndoManager skips them; replay order is wal_seq ascending,
 * matching commit order.
 *
 * Note: fresh-signup boots do NOT use this helper. They use
 * `Doc.create()` (seeded built-ins) and a separate
 * `wal.loadForReplay()` to initialise the empty WAL store.
 */
export async function bootWal(opts: BootWalOpts): Promise<BootWalResult> {
  const replay = await opts.wal.loadForReplay();
  // `loadForReplay` already batched the device row; only fall back
  // to a separate get if an implementation skipped batching.
  const device =
    replay.device !== undefined ? replay.device : await opts.wal.getDevice();
  const doc = replay.snapshot ? opts.loadDoc(replay.snapshot) : opts.emptyDoc();
  const replayErrors: { walSeq: number; error: unknown }[] = [];
  for (const entry of replay.walEntries) {
    try {
      doc.importWalUpdates(entry.plaintext);
    } catch (e) {
      replayErrors.push({ walSeq: entry.walSeq, error: e });
    }
  }
  return {
    doc,
    snapshotWalSeq: replay.snapshotWalSeq,
    device,
    replayErrors,
  };
}
