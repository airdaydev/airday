// @airday/core — JS facade for the wasm-bindgen wrapper plus the
// pluggable storage adapter the eventual web/Bun clients will use to
// persist `Doc` snapshots and per-device config.

export { Doc, Dek, EncryptedBlob } from "../wasm/airday_core_web.js";
export type {
  StorageAdapter,
  DeviceConfig,
} from "./storage/adapter.ts";
export { MemStorage } from "./storage/mem.ts";
export { BunFileStorage } from "./storage/file.ts";
