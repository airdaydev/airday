import type { DeviceConfig, StorageAdapter } from "./adapter.ts";

/** No-op adapter for environments where local persistence is unavailable
 * (e.g. Firefox private browsing, where OPFS throws SecurityError). The
 * sync engine still functions; reloads just resync from the server. */
export class NullStorage implements StorageAdapter {
  async getDoc(): Promise<Uint8Array | null> {
    return null;
  }
  async putDoc(): Promise<void> {}
  async getDevice(): Promise<DeviceConfig | null> {
    return null;
  }
  async putDevice(): Promise<void> {}
  async clear(): Promise<void> {}
}
