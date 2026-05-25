// @airday/core — storage adapters + types. The wasm-bindgen surface
// (`Doc`, `Dek`, `SyncEngine`, ...) lives at `@airday/core/wasm` so
// the conditional export resolves to the bundler-target build under
// Vite and the nodejs-target build under Bun without callers
// thinking about it.

export type {
  StorageAdapter,
  DeviceConfig,
} from "./storage/adapter.ts";
export { MemStorage } from "./storage/mem.ts";
export { BunFileStorage } from "./storage/file.ts";
export { probeOpfs } from "./storage/opfs-probe.ts";
export { IdbWalStorage } from "./storage/idb-wal.ts";
export { MemWalStorage } from "./storage/mem-wal.ts";
export {
  SNAPSHOT_THRESHOLD,
  type ReplayPayload,
  type WalEntry,
  type WalStorage,
} from "./storage/wal-adapter.ts";
export {
  SyncBridge,
  type ConnectionEvent,
  type ReconnectBackoff,
  type SyncBridgeOpts,
} from "./sync-bridge.ts";
