// Invariant: the engine must not ship an `Ack { last_acked_seq = N }`
// frame until the host has confirmed that the WAL row covering the
// bytes for seq N is durably committed.
//
// Without a stallable WAL there's no observation window between
// "engine applied the op" and "WAL row on disk" — the IndexedDB
// write completes in microseconds. This test inserts a pausable
// `WalStorage` between the engine and the WAL, drives an inbound
// `OpsBroadcast` through the real wasm `SyncEngine` and the real
// `WalBridge`, and asserts:
//
//   1. While the WAL append is pending, no `Ack` frame is in the
//      engine outbox (it was never queued).
//   2. After releasing the pending append, the `Ack` is queued and
//      can be drained, and the `onDurable` callback fires.
//
// Companion to the engine-level Rust tests in `core/src/sync.rs`
// (`inbound_apply_does_not_queue_ack_until_durable`,
// `notify_wal_durable_is_monotonic_and_coalesces`); those cover the
// engine state machine alone, this one covers the full
// `engine + WalBridge + stallable WAL` wiring.

import { describe, expect, test } from "bun:test";
import { encode, decode } from "@msgpack/msgpack";

import {
  Dek,
  Doc,
  EncryptedBlob,
  SyncEngine,
} from "../wasm/airday_core_web.js";
import { WalBridge } from "../src/wal-bridge.ts";
import { MemWalStorage } from "../src/storage/mem-wal.ts";
import type { WalStorage } from "../src/storage/wal-adapter.ts";

const PROTOCOL_VERSION = 1;
const LIST_MAIN = "main";

// ----- stallable storage --------------------------------------------------

interface PendingAppend {
  release: () => void;
  ready: Promise<void>;
}

/**
 * Wraps a `MemWalStorage`. Each `appendWal` is paused at a gate that
 * the test releases manually; `commitSnapshot` likewise. Everything
 * else delegates straight to the inner store.
 */
class StallableWal implements WalStorage {
  readonly pending: PendingAppend[] = [];
  /** Total `appendWal` calls observed (released or not). */
  appendCount = 0;

  constructor(private readonly inner: MemWalStorage) {}

  loadForReplay() {
    return this.inner.loadForReplay();
  }
  shouldSnapshot() {
    return this.inner.shouldSnapshot();
  }
  highestWalSeq() {
    return this.inner.highestWalSeq();
  }
  getDevice() {
    return this.inner.getDevice();
  }
  putDevice(d: import("../src/storage/adapter.ts").DeviceConfig) {
    return this.inner.putDevice(d);
  }
  clear() {
    this.pending.length = 0;
    return this.inner.clear();
  }

  async appendWal(plaintext: Uint8Array): Promise<number> {
    this.appendCount += 1;
    const gate = makeGate();
    this.pending.push(gate);
    await gate.ready;
    return this.inner.appendWal(plaintext);
  }

  /** Yield until at least one gate is queued, then release it. Use
   *  this when a chained `appendWal` may not have been queued yet at
   *  the moment of the call. */
  async releaseWhenReady(): Promise<void> {
    while (this.pending.length === 0) {
      await new Promise((res) => setTimeout(res, 0));
    }
    this.releaseNext();
  }

  /** Release every gate, waiting briefly between releases so the
   *  next chained `appendWal` can register before we give up. */
  async drainAllGates(): Promise<void> {
    // Give the chain a few microtask ticks to queue any follow-up
    // append before we declare it idle. We bound this so a bug
    // can't loop forever.
    for (let i = 0; i < 20; i++) {
      if (this.pending.length > 0) {
        this.releaseNext();
        // Let the released gate's continuation run before checking
        // for the next one.
        await new Promise((res) => setTimeout(res, 0));
        await new Promise((res) => setTimeout(res, 0));
      } else {
        await new Promise((res) => setTimeout(res, 0));
        if (this.pending.length === 0) return;
      }
    }
  }

  async commitSnapshot(plaintext: Uint8Array, seq: number): Promise<void> {
    const gate = makeGate();
    this.pending.push(gate);
    await gate.ready;
    return this.inner.commitSnapshot(plaintext, seq);
  }

  releaseNext(): void {
    const next = this.pending.shift();
    if (!next) throw new Error("no pending append to release");
    next.release();
  }
}

function makeGate(): PendingAppend {
  let release!: () => void;
  const ready = new Promise<void>((res) => {
    release = res;
  });
  return { release, ready };
}

// ----- frame construction --------------------------------------------------

/** msgpack-encoded HelloAck. The engine matches on raw bytes for the
 *  handshake, not the ServerFrame enum. */
function helloAckBytes(): Uint8Array {
  return encode({
    server_version: "test",
    protocol_version: PROTOCOL_VERSION,
  });
}

function emptyBatchCompleteBytes(): Uint8Array {
  return encode({
    type: "OpsBatch",
    ops: [],
    complete: true,
  });
}

/** Build a `ServerFrame::OpsBroadcast` carrying one StoredBlob. The
 *  wire encodes `seq` as msgpack uint — a plain JS number is fine for
 *  the small values this test uses. */
function broadcastBytes(seq: number, blob: EncryptedBlob): Uint8Array {
  return encode({
    type: "OpsBroadcast",
    ops: [
      {
        seq,
        blob: {
          nonce: blob.nonce,
          ciphertext: blob.ciphertext,
        },
      },
    ],
  });
}

/** Drive an engine through Hello → HelloAck → PullOps → empty OpsBatch
 *  → Idle, discarding the outbound frames. Leaves the engine at the
 *  start of the "live" steady state. */
function driveToIdle(eng: SyncEngine): void {
  eng.handleConnected();
  eng.popOutbox(); // Hello
  eng.handleServerBytes(helloAckBytes());
  eng.popOutbox(); // PullOps
  eng.handleServerBytes(emptyBatchCompleteBytes());
  if (!eng.isIdle()) {
    throw new Error("expected engine to be idle after empty pull");
  }
}

/** Run the microtask queue to completion. The append + notify chain
 *  is built from `.then()` continuations, so awaiting a fresh promise
 *  lets every pending continuation fire. */
function flushMicrotasks(): Promise<void> {
  return new Promise((res) => setTimeout(res, 0));
}

function decodeClientFrame(bytes: Uint8Array): { type: string; last_acked_seq?: number | bigint } {
  return decode(bytes) as { type: string; last_acked_seq?: number | bigint };
}

// ----- the test --------------------------------------------------

describe("inbound Ack is gated on WAL durability", () => {
  test("OpsBroadcast: Ack not queued until WAL row committed", async () => {
    // Two engines sharing a DEK. Engine A is just a scratch source
    // for producing an encrypted "remote" blob — we don't drive its
    // protocol state. Engine B is the system under test.
    const dek = Dek.generate();
    // Scratch peer doc — mutate, export, encrypt; never wired into a
    // SyncEngine (would consume the Doc and hide its pendingExport).
    const docA = Doc.create();
    docA.markPushed();
    docA.addItem(LIST_MAIN, "from-peer");
    const blob = docA.pendingExport(dek)!;
    expect(blob).toBeDefined();

    const docB = Doc.empty();
    docB.markPushed();
    const engineB = new SyncEngine(docB, dek.clone(), 0n, "test-b", "0.0.0");
    driveToIdle(engineB);

    // Mem WAL → stallable wrapper → real WalBridge wired with an
    // onDurable counter. Initial cursor = current oplog VV so the
    // bridge captures only what arrives after this point.
    const innerWal = new MemWalStorage(dek.clone(), EncryptedBlob);
    await innerWal.loadForReplay();
    const wal = new StallableWal(innerWal);
    let durableCount = 0;
    const bridge = new WalBridge({
      engine: engineB,
      wal,
      initialCursor: engineB.oplogVvBytes(),
      onDurable: () => {
        durableCount += 1;
      },
    });

    // Inbound: deliver the encrypted op as OpsBroadcast at seq=7.
    engineB.handleServerBytes(broadcastBytes(7, blob));

    // Engine has applied in memory but must not have queued an Ack.
    expect(engineB.lastContiguousSeq()).toBe(7n);
    expect(engineB.lastDurableSeq()).toBe(0n);
    expect(durableCount).toBe(0);
    expect(drainOutbox(engineB).filter(isAck).length).toBe(0);

    // App.tsx's onServerFrame fires captureAndAppend after a server
    // frame applies. Simulate that here.
    bridge.captureAndAppend();

    // The WAL append is stalled at the gate. notify_wal_durable
    // cannot have fired; Ack still not on the wire.
    await flushMicrotasks();
    expect(wal.pending.length).toBe(1);
    expect(engineB.lastDurableSeq()).toBe(0n);
    expect(durableCount).toBe(0);
    expect(drainOutbox(engineB).filter(isAck).length).toBe(0);

    // Release the WAL append → the chain runs notify_wal_durable → the
    // engine queues an Ack → onDurable fires.
    wal.releaseNext();
    await bridge.drain();

    expect(engineB.lastDurableSeq()).toBe(7n);
    expect(durableCount).toBe(1);

    const acks = drainOutbox(engineB).filter(isAck);
    expect(acks.length).toBe(1);
    const decoded = decodeClientFrame(acks[0]!);
    expect(decoded.type).toBe("Ack");
    expect(BigInt(decoded.last_acked_seq as number | bigint)).toBe(7n);
  });

  test("OpsAck (locally-pushed): Ack not queued until prior captureAndAppend's WAL row commits", async () => {
    // Pure local-mutation flow: user mutates, captureAndAppend fires
    // (queues an append behind the gate), engine pushes, server
    // OpsAcks with seq=4. The OpsAck would historically queue an
    // Ack { 4 } immediately; now it must wait for the gated append
    // to land.
    const dek = Dek.generate();
    const doc = Doc.create();
    doc.markPushed();
    const engine = new SyncEngine(doc, dek.clone(), 0n, "test", "0.0.0");
    driveToIdle(engine);

    const innerWal = new MemWalStorage(dek.clone(), EncryptedBlob);
    await innerWal.loadForReplay();
    const wal = new StallableWal(innerWal);
    let durableCount = 0;
    const bridge = new WalBridge({
      engine,
      wal,
      initialCursor: engine.oplogVvBytes(),
      onDurable: () => {
        durableCount += 1;
      },
    });

    // Local mutation → captureAndAppend (gated) → engine.flush → PushOps.
    engine.addItem(LIST_MAIN, "local");
    bridge.captureAndAppend();
    engine.flush();
    const pushFrame = engine.popOutbox();
    expect(pushFrame).toBeDefined();
    expect(decodeClientFrame(pushFrame!).type).toBe("PushOps");

    // Server returns OpsAck assigning seq=4. Engine advances
    // last_contiguous_seq but, with the gate held, the corresponding
    // Ack-back-to-server must NOT yet appear.
    engine.handleServerBytes(encode({ type: "OpsAck", assigned_seqs: [4] }));
    expect(engine.lastContiguousSeq()).toBe(4n);
    expect(engine.lastDurableSeq()).toBe(0n);
    bridge.captureAndAppend(); // matches App.tsx onServerFrame
    await flushMicrotasks();
    expect(drainOutbox(engine).filter(isAck).length).toBe(0);
    expect(durableCount).toBe(0);

    // Release every gated append in arrival order. `try_start_push`
    // calls Loro's `export` which performs a housekeeping commit —
    // so the post-OpsAck `captureAndAppend` may see a small delta
    // and queue a SECOND `appendWal`. Release as gates appear, then
    // drain.
    await wal.drainAllGates();
    await bridge.drain();

    expect(engine.lastDurableSeq()).toBe(4n);
    const acks = drainOutbox(engine).filter(isAck);
    expect(acks.length).toBe(1);
    expect(BigInt(decodeClientFrame(acks[0]!).last_acked_seq as bigint)).toBe(
      4n,
    );
    expect(durableCount).toBeGreaterThanOrEqual(1);
  });
});

function drainOutbox(eng: SyncEngine): Uint8Array[] {
  const out: Uint8Array[] = [];
  while (true) {
    const f = eng.popOutbox();
    if (!f) break;
    out.push(f);
  }
  return out;
}

function isAck(bytes: Uint8Array): boolean {
  try {
    const f = decodeClientFrame(bytes);
    return f.type === "Ack";
  } catch {
    return false;
  }
}
