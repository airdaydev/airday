import type { DeviceConfig, StorageAdapter } from "./adapter.ts";

/** In-memory adapter for headless tests. Single-account, ephemeral. */
export class MemStorage implements StorageAdapter {
  private doc: Uint8Array | null = null;
  private device: DeviceConfig | null = null;

  async getDoc(): Promise<Uint8Array | null> {
    return this.doc ? new Uint8Array(this.doc) : null;
  }

  async putDoc(bytes: Uint8Array): Promise<void> {
    this.doc = new Uint8Array(bytes);
  }

  async getDevice(): Promise<DeviceConfig | null> {
    return this.device ? { ...this.device } : null;
  }

  async putDevice(device: DeviceConfig): Promise<void> {
    this.device = { ...device };
  }

  async clear(): Promise<void> {
    this.doc = null;
    this.device = null;
  }
}
