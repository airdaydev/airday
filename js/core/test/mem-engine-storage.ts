// Shared in-memory `EngineStorage` test double. Same shape the wasm
// extern calls, same semantics as `core::MemStorage`. Method names line
// up with the `EngineStorage` interface generated into the wasm `.d.ts`.
//
// The engine's push path is outbox-driven on every host
// (`spec/local-storage.md`), so any test that constructs a
// `SyncEngine` must hand it a real storage. Tests that only use the
// engine as a doc / AppEvent source still need one to satisfy the
// (now-mandatory) constructor — they just never call `captureLocalOps`.
//
// Cast to `EngineStorage` at the call site with `as unknown as
// EngineStorage` (the wasm interface is structural; the cast keeps each
// test pinned to its own wasm import).
//
// ⚠️ The `ciphertext` / `nonce` / `clientOpId` args arrive as
// `Uint8Array` **views into wasm linear memory**, valid only for the
// synchronous extern call. Because this mirror retains them past that
// call (and ships them back to wasm later via `outbox`), it MUST copy
// on entry — exactly like the real `IdbStorage` (`copyBytes` =
// `.slice()`). Without the copy, a capture that's read back after the
// wasm allocator reuses that memory yields corrupted ciphertext →
// decrypt fails on the peer. (See `spec/local-storage.md`.)

interface MirrorOp {
  localSeq: number;
  clientOpId?: string;
  serverSeq?: number;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

function copy(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

export class MemEngineStorage {
  nextLocalSeq = 0;
  ops: MirrorOp[] = [];
  snapshot: { upToLocalSeq: number; ciphertext: Uint8Array; nonce: Uint8Array } | null = null;
  lastAckedServerSeq = 0;

  appendLocalOp(clientOpId: Uint8Array, ciphertext: Uint8Array, nonce: Uint8Array): number {
    const localSeq = ++this.nextLocalSeq;
    this.ops.push({ localSeq, clientOpId: hex(clientOpId), ciphertext: copy(ciphertext), nonce: copy(nonce) });
    return localSeq;
  }

  appendRemoteOp(serverSeq: number, ciphertext: Uint8Array, nonce: Uint8Array): number {
    const existing = this.ops.find((o) => o.serverSeq === serverSeq);
    if (existing) return existing.localSeq;
    const localSeq = ++this.nextLocalSeq;
    // Cursor advances only via writeAckedSeq (mirrors core::MemStorage).
    this.ops.push({ localSeq, serverSeq, ciphertext: copy(ciphertext), nonce: copy(nonce) });
    return localSeq;
  }

  ackLocalOp(clientOpId: Uint8Array, serverSeq: number): void {
    const h = hex(clientOpId);
    const op = this.ops.find((o) => o.clientOpId === h);
    if (!op) throw new Error(`ackLocalOp: unknown clientOpId ${h}`);
    op.serverSeq = serverSeq;
  }

  writeAckedSeq(serverSeq: number): void {
    this.lastAckedServerSeq = serverSeq;
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
    this.snapshot = { upToLocalSeq, ciphertext: copy(ciphertext), nonce: copy(nonce) };
    this.ops = this.ops.filter((o) => o.localSeq > upToLocalSeq);
  }
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function unhex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
