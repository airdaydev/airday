// BunFileStorage smoke: round-trip the doc envelope and device config
// against the real filesystem in a tempdir. The CLI uses an
// equivalent on-disk layout (see `cli/src/config.rs`); this test
// exists so we catch shape drift between the two early.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Doc } from "../wasm/airday_core_web.js";
import { BunFileStorage } from "../src/index.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "airday-core-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("BunFileStorage", () => {
  test("doc bytes round-trip through the filesystem", async () => {
    const storage = new BunFileStorage(root);
    expect(await storage.getDoc()).toBeNull();

    const doc = Doc.create();
    doc.addItem("main", "persisted via Bun");
    const before = doc.fingerprint();

    await storage.putDoc(doc.save());
    const restoredBytes = await storage.getDoc();
    expect(restoredBytes).not.toBeNull();

    const restored = Doc.load(restoredBytes!);
    expect(Array.from(restored.fingerprint())).toEqual(Array.from(before));
  });

  test("device config round-trips as JSON", async () => {
    const storage = new BunFileStorage(root);
    const cfg = {
      accountId: "acct-aaaaaaaa",
      email: "user@example.com",
      serverUrl: "http://localhost:8080",
      deviceId: "dev-aaaaaaaa",
      lastAckedBlobId: 0,
      lastSyncAt: null,
    };
    await storage.putDevice(cfg);
    expect(await storage.getDevice()).toEqual(cfg);
  });

  test("clear removes the directory", async () => {
    const storage = new BunFileStorage(root);
    await storage.putDoc(new Uint8Array([1, 2, 3]));
    await storage.clear();
    expect(await storage.getDoc()).toBeNull();
  });
});
