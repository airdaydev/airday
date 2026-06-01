// Phase 2 (`spec/local-storage-plan.md`): the web client drives the
// engine through a JS-implemented `EngineStorage` (the in-memory mirror
// behind `IdbStorage`). This test exercises that wasm boundary —
// `captureLocalOps` / `snapshotIfFullySynced` / `setLastLocalSeq` plus
// the `EngineStorage` extern — without IndexedDB or a server, using a
// hand-rolled in-memory mirror that mirrors `core::MemStorage`'s
// semantics. It locks in the contract the real `IdbStorage` satisfies:
//
//   - a captured local op shows up in the outbox and is shipped as the
//     PushOps blob (outbox-driven path, not legacy `pending_export`);
//   - an `OpsAck` stamps the row's `serverSeq` and drains the outbox;
//   - once drained, `snapshotIfFullySynced` compacts and prunes;
//   - remote ops applied from the wire are mirrored via `appendRemoteOp`
//     and never appear in the outbox.

import { describe, expect, test } from "bun:test";
import { decode, encode } from "@msgpack/msgpack";

import { Dek, Doc, EncryptedBlob, SyncEngine } from "../wasm/airday_core_web.js";

const PROTOCOL_VERSION = 1;
const LIST_MAIN = "main";
const DOC_ID = "00000000-0000-0000-0000-000000000000";

// In-memory `EngineStorage` — same shape the wasm extern calls, same
// semantics as `core::MemStorage`. Method names line up with the
// `EngineStorage` interface generated into the wasm `.d.ts`.
interface MirrorOp {
  localSeq: number;
  clientOpId?: string;
  serverSeq?: number;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

class MemEngineStorage {
  nextLocalSeq = 0;
  ops: MirrorOp[] = [];
  snapshot: { upToLocalSeq: number; ciphertext: Uint8Array; nonce: Uint8Array } | null = null;
  lastAckedServerSeq = 0;

  appendLocalOp(clientOpId: Uint8Array, ciphertext: Uint8Array, nonce: Uint8Array): number {
    const localSeq = ++this.nextLocalSeq;
    this.ops.push({ localSeq, clientOpId: hex(clientOpId), ciphertext, nonce });
    return localSeq;
  }

  appendRemoteOp(serverSeq: number, ciphertext: Uint8Array, nonce: Uint8Array): number {
    const existing = this.ops.find((o) => o.serverSeq === serverSeq);
    if (existing) return existing.localSeq;
    const localSeq = ++this.nextLocalSeq;
    if (serverSeq > this.lastAckedServerSeq) this.lastAckedServerSeq = serverSeq;
    this.ops.push({ localSeq, serverSeq, ciphertext, nonce });
    return localSeq;
  }

  ackLocalOp(clientOpId: Uint8Array, serverSeq: number): void {
    const h = hex(clientOpId);
    const op = this.ops.find((o) => o.clientOpId === h);
    if (!op) throw new Error(`ackLocalOp: unknown clientOpId ${h}`);
    op.serverSeq = serverSeq;
    if (serverSeq > this.lastAckedServerSeq) this.lastAckedServerSeq = serverSeq;
  }

  outbox(): { localSeq: number; clientOpId: Uint8Array; ciphertext: Uint8Array; nonce: Uint8Array }[] {
    return this.ops
      .filter((o) => o.clientOpId != null && o.serverSeq == null)
      .sort((a, b) => a.localSeq - b.localSeq)
      .map((o) => ({
        localSeq: o.localSeq,
        clientOpId: unhex(o.clientOpId as string),
        ciphertext: o.ciphertext,
        nonce: o.nonce,
      }));
  }

  writeSnapshot(upToLocalSeq: number, ciphertext: Uint8Array, nonce: Uint8Array): void {
    this.snapshot = { upToLocalSeq, ciphertext, nonce };
    this.ops = this.ops.filter((o) => o.localSeq > upToLocalSeq);
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function helloAckBytes(): Uint8Array {
  return encode({ server_version: "test", protocol_version: PROTOCOL_VERSION });
}
function emptyBatchCompleteBytes(): Uint8Array {
  return encode({ type: "OpsBatch", ops: [], complete: true });
}
function broadcastBytes(seq: number, blob: EncryptedBlob): Uint8Array {
  return encode({
    type: "OpsBroadcast",
    ops: [{ seq, blob: { nonce: blob.nonce, ciphertext: blob.ciphertext } }],
  });
}

/** Hello → HelloAck → PullOps → empty OpsBatch → Idle. */
function driveToIdle(eng: SyncEngine): void {
  eng.handleConnected();
  eng.popOutbox(); // Hello
  eng.handleServerBytes(helloAckBytes(), 0n);
  eng.popOutbox(); // PullOps
  eng.handleServerBytes(emptyBatchCompleteBytes(), 0n);
  if (!eng.isIdle()) throw new Error("expected engine idle after empty pull");
}

describe("engine ↔ EngineStorage (outbox-driven web path)", () => {
  test("capture → PushOps from outbox → OpsAck → compaction", () => {
    const dek = Dek.generate();
    const storage = new MemEngineStorage();
    const doc = Doc.create();
    const engine = new SyncEngine(
      doc,
      DOC_ID,
      dek.clone(),
      0n,
      "test",
      "0.0.0",
      storage as unknown as import("../wasm/airday_core_web.js").EngineStorage,
    );
    engine.setLastLocalSeq(0);
    driveToIdle(engine);

    // A local mutation, then capture it as one durable local op row.
    engine.addItem(LIST_MAIN, "task one");
    const seq = engine.captureLocalOps();
    expect(seq).toBe(1);
    expect(storage.ops.length).toBe(1);
    expect(storage.outbox().length).toBe(1);
    // Nothing pending in the doc now — the engine advanced the cursor.
    expect(engine.hasPendingOps()).toBe(false);

    // Flush ships the captured outbox row as the PushOps blob (not the
    // legacy pending_export path, which would have nothing to send).
    engine.flush();
    const frame = engine.popOutbox();
    expect(frame).toBeDefined();
    const decoded = decode(frame!) as { type: string; ops: unknown[] };
    expect(decoded.type).toBe("PushOps");
    expect(decoded.ops.length).toBe(1);

    // Server assigns seq=1; OpsAck stamps the row and drains the outbox.
    engine.handleServerBytes(encode({ type: "OpsAck", assigned_seqs: [1] }), 0n);
    expect(storage.ops[0]!.serverSeq).toBe(1);
    expect(storage.outbox().length).toBe(0);
    expect(engine.lastContiguousSeq()).toBe(1n);

    // Fully synced → compaction writes a snapshot at localSeq=1 and
    // prunes the folded row.
    const wrote = engine.snapshotIfFullySynced();
    expect(wrote).toBe(true);
    expect(storage.snapshot).not.toBeNull();
    expect(storage.snapshot!.upToLocalSeq).toBe(1);
    expect(storage.ops.length).toBe(0);

    // A second compaction with nothing new is a no-op.
    expect(engine.snapshotIfFullySynced()).toBe(false);
  });

  test("remote ops are mirrored via appendRemoteOp, never in the outbox", () => {
    const dek = Dek.generate();

    // Scratch peer doc: produce an encrypted remote blob.
    const peer = Doc.create();
    peer.markPushed();
    peer.addItem(LIST_MAIN, "from-peer");
    const blob = peer.pendingExport(dek)!;
    expect(blob).toBeDefined();

    const storage = new MemEngineStorage();
    const doc = Doc.empty();
    doc.markPushed();
    const engine = new SyncEngine(
      doc,
      DOC_ID,
      dek.clone(),
      0n,
      "test",
      "0.0.0",
      storage as unknown as import("../wasm/airday_core_web.js").EngineStorage,
    );
    engine.setLastLocalSeq(0);
    driveToIdle(engine);

    engine.handleServerBytes(broadcastBytes(1, blob), 0n);

    expect(storage.ops.length).toBe(1);
    expect(storage.ops[0]!.serverSeq).toBe(1);
    expect(storage.ops[0]!.clientOpId).toBeUndefined();
    expect(storage.outbox().length).toBe(0);
    expect(engine.lastContiguousSeq()).toBe(1n);

    // The remote op materialised into the doc.
    const items = JSON.parse(engine.itemsInListJson(LIST_MAIN, false)) as Array<{ text: string }>;
    expect(items.map((i) => i.text)).toContain("from-peer");
  });
});
