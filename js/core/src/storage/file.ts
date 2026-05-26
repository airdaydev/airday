// Bun-only file-backed storage. Mirrors the CLI's on-disk layout:
//   <root>/device.json
//   <root>/loro.bin
//
// `<root>` is whatever path the caller hands us — typically a per-
// account dir under the platform data home. We don't reach for
// `dirs::data_local_dir`'s JS equivalent here; that policy belongs to
// the consumer (CLI, tests, web bootstrap shim).

import {
  normalizeDeviceConfig,
  type DeviceConfig,
  type StorageAdapter,
} from "./adapter.ts";

const DEVICE_FILE = "device.json";
const DOC_FILE = "loro.bin";

export class BunFileStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  async getDoc(): Promise<Uint8Array | null> {
    const file = Bun.file(`${this.root}/${DOC_FILE}`);
    if (!(await file.exists())) return null;
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  }

  async putDoc(bytes: Uint8Array): Promise<void> {
    await this.ensureRoot();
    await Bun.write(`${this.root}/${DOC_FILE}`, bytes);
  }

  async getDevice(): Promise<DeviceConfig | null> {
    const file = Bun.file(`${this.root}/${DEVICE_FILE}`);
    if (!(await file.exists())) return null;
    return normalizeDeviceConfig(await file.json());
  }

  async putDevice(device: DeviceConfig): Promise<void> {
    await this.ensureRoot();
    await Bun.write(
      `${this.root}/${DEVICE_FILE}`,
      JSON.stringify(device, null, 2),
    );
  }

  async clear(): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.rm(this.root, { recursive: true, force: true });
  }

  private async ensureRoot(): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.mkdir(this.root, { recursive: true });
  }
}
