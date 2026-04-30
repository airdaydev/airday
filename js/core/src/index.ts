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
export { OpfsStorage, probeOpfs } from "./storage/opfs.ts";
export { NullStorage } from "./storage/null.ts";
