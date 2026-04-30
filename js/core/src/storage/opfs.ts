// Origin Private File System adapter. Mirrors the Bun file-storage
// shape — write a doc blob, read it back — but uses the browser's
// `navigator.storage.getDirectory()` so the underlying bytes are
// scoped to the page origin and inaccessible to other origins. The
// snapshot blob is encrypted with the account DEK before write; the
// encryption layer is one of the e2ee primitives the wasm `Dek`
// already exposes (`seal` / `open`).
//
// Async, main-thread API (no sync access handles, no worker). The
// parent doc tracks worker move as out-of-scope for slice 4.

import type { Dek, EncryptedBlob } from "../../wasm/airday_core_web.js";
import type { DeviceConfig, StorageAdapter } from "./adapter.ts";

const DOC_FILE = "loro.bin";
const DEVICE_FILE = "device.json";

export class OpfsStorage implements StorageAdapter {
  /**
   * @param accountId  Used as the directory name so multiple
   *   accounts on one origin don't collide.
   * @param dek        DEK used to seal/open the on-disk snapshot
   *   blob. Must be the account's real DEK — re-deriving it
   *   between sessions is the point of the password-based KDF.
   * @param wasm       The wasm module's `EncryptedBlob` constructor.
   *   Imports of wasm types in `js/core` would re-introduce the
   *   nodejs-target build into browser bundles; the consumer
   *   threads its own `EncryptedBlob` (from `@airday/core/wasm`)
   *   here instead.
   */
  constructor(
    private readonly accountId: string,
    private readonly dek: Dek,
    private readonly EncryptedBlobCtor: new (
      nonce: Uint8Array,
      ciphertext: Uint8Array,
    ) => EncryptedBlob,
  ) {}

  async getDoc(): Promise<Uint8Array | null> {
    const file = await this.tryReadFile(DOC_FILE);
    if (!file) return null;
    if (file.byteLength < 24) return null; // too small to be a sealed envelope
    const nonce = file.subarray(0, 24);
    const ciphertext = file.subarray(24);
    const blob = new this.EncryptedBlobCtor(nonce, ciphertext);
    return this.dek.open(blob);
  }

  async putDoc(bytes: Uint8Array): Promise<void> {
    const blob = this.dek.seal(bytes);
    const out = new Uint8Array(blob.nonce.length + blob.ciphertext.length);
    out.set(blob.nonce, 0);
    out.set(blob.ciphertext, blob.nonce.length);
    await this.writeFile(DOC_FILE, out);
  }

  async getDevice(): Promise<DeviceConfig | null> {
    const bytes = await this.tryReadFile(DEVICE_FILE);
    if (!bytes) return null;
    return JSON.parse(new TextDecoder().decode(bytes)) as DeviceConfig;
  }

  async putDevice(device: DeviceConfig): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(device, null, 2));
    await this.writeFile(DEVICE_FILE, bytes);
  }

  async clear(): Promise<void> {
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry(this.accountId, { recursive: true });
    } catch {
      // already gone — ignore
    }
  }

  private async dir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(this.accountId, { create: true });
  }

  private async tryReadFile(name: string): Promise<Uint8Array | null> {
    try {
      const dir = await this.dir();
      const fh = await dir.getFileHandle(name);
      const file = await fh.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  private async writeFile(name: string, bytes: Uint8Array): Promise<void> {
    const dir = await this.dir();
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    // Copy into a fresh ArrayBuffer (not SharedArrayBuffer-backed) so
    // FileSystemWritableFileStream's narrower type accepts it.
    const buf = new Uint8Array(bytes.byteLength);
    buf.set(bytes);
    await w.write(buf);
    await w.close();
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

/** Probe OPFS availability by attempting to acquire the origin root. Firefox
 * private windows expose `navigator.storage.getDirectory` but throw
 * SecurityError when called; this collapses that into a boolean. */
export async function probeOpfs(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined") return false;
    if (!navigator.storage?.getDirectory) return false;
    await navigator.storage.getDirectory();
    return true;
  } catch {
    return false;
  }
}
