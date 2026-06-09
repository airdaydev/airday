// @airday/core — storage adapters + types. The wasm-bindgen surface
// (`Doc`, `Dek`, `SyncEngine`, ...) lives at `@airday/core/wasm` so
// the conditional export resolves to the bundler-target build under
// Vite and the nodejs-target build under Bun without callers
// thinking about it.

export type { DeviceConfig } from "./storage/adapter.ts";
export {
  IdbStorage,
  type EngineBootRows,
  type OutboxRowJs,
} from "./storage/idb-storage.ts";
export {
  openEngineDb,
  _resetEngineDbForTests,
  ENGINE_DB_NAME,
  ENGINE_DB_VERSION,
} from "./storage/engine-db.ts";
export { getDevice, putDevice } from "./storage/device-store.ts";
export {
  DekVault,
  type DekFromHex,
  type VaultedSession,
} from "./storage/dek-vault.ts";
export {
  SyncBridge,
  type ConnectionEvent,
  type ReconnectBackoff,
  type SyncBridgeOpts,
} from "./sync-bridge.ts";
