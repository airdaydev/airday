// Storage abstraction for the airday core.
//
// One adapter instance owns one account's local state. The Rust core
// stays storage-agnostic; the JS layer picks an adapter (in-memory for
// tests, Bun file-backed for headless smoke runs, IndexedDB for the
// browser) and feeds the saved `loro.bin` bytes back into `Doc.load`.
//
// The shape mirrors the CLI's on-disk layout (`device.json` +
// `loro.bin`) but consciously *omits* the secrets file. DEK lifetime
// in the browser is in-memory only; the Bun adapter is a development
// convenience and persists the DEK out-of-band the same way the CLI
// does.

export interface DeviceConfig {
  accountId: string;
  /** Server-assigned id of the account's primary (Home) doc. */
  primaryDocId: string;
  email: string;
  serverUrl: string;
  deviceId: string;
  /** Unix millis of the last successful online sync, or null.
   *  Observability only (the "Synced …" status) — the resume cursor is
   *  the engine's, persisted via `IdbStorage.writeAckedSeq`. */
  lastSyncAt: number | null;
}

export function normalizeDeviceConfig(value: unknown): DeviceConfig | null {
  if (!value || typeof value !== "object") return null;
  const device = value as DeviceConfig;
  if (
    typeof device.accountId !== "string" ||
    typeof device.primaryDocId !== "string" ||
    typeof device.email !== "string" ||
    typeof device.serverUrl !== "string" ||
    typeof device.deviceId !== "string"
  ) {
    return null;
  }
  const lastSyncAt =
    typeof device.lastSyncAt === "number" || device.lastSyncAt === null
      ? device.lastSyncAt
      : null;
  return {
    accountId: device.accountId,
    primaryDocId: device.primaryDocId,
    email: device.email,
    serverUrl: device.serverUrl,
    deviceId: device.deviceId,
    lastSyncAt,
  };
}

/** Storage adapter contract. Methods are async to accommodate IDB. */
export interface StorageAdapter {
  /** Read the saved loro snapshot envelope, or null if none exists. */
  getDoc(): Promise<Uint8Array | null>;
  /** Persist the loro snapshot envelope verbatim. */
  putDoc(bytes: Uint8Array): Promise<void>;
  /** Read the device config, or null if the profile is fresh. */
  getDevice(): Promise<DeviceConfig | null>;
  /** Persist device config. */
  putDevice(device: DeviceConfig): Promise<void>;
  /** Wipe all state owned by this adapter. Used by `airday logout`. */
  clear(): Promise<void>;
}
