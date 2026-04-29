// Storage abstraction for the airday core.
//
// One adapter instance owns one account's local state. The Rust core
// stays storage-agnostic; the JS layer picks an adapter (in-memory for
// tests, Bun file-backed for headless smoke runs, IndexedDB for the
// browser) and feeds the saved `loro.bin` bytes back into `Doc.load`.
//
// The shape mirrors the CLI's on-disk layout (`device.json` +
// `loro.bin`) but consciously *omits* the secrets file. DEK lifetime
// in the browser is in-memory only; the Bun adapter is a sprint-1
// development convenience and persists the DEK out-of-band the same
// way the CLI does.

export interface DeviceConfig {
  accountId: string;
  email: string;
  serverUrl: string;
  deviceId: string;
  /** Sync engine's frontier. 0 until the sync slice ships. */
  lastAckedOpId: number;
  /** Unix millis of the last successful online flush, or null. */
  lastSyncAt: number | null;
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
