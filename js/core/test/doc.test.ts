// Headless smoke for the wasm Doc surface plus the in-memory adapter.
//
// First-commit target from `wasm-plan.md`: build a doc, mutate it, run
// it through the storage adapter, reload, and prove the logical
// fingerprint survives the round trip.

import { describe, expect, test } from "bun:test";

import { Dek, Doc, EncryptedBlob } from "../wasm/airday_core_web.js";
import { MemStorage } from "../src/index.ts";

const LIST_MAIN = "main";

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe("Doc + MemStorage", () => {
  test("addItem → save → put → get → load → fingerprint matches", async () => {
    const doc = Doc.create();
    const itemId = doc.addItem(LIST_MAIN, "buy milk");

    const before = doc.fingerprint();
    const bytes = doc.save();

    const storage = new MemStorage();
    await storage.putDoc(bytes);
    const restoredBytes = await storage.getDoc();
    expect(restoredBytes).not.toBeNull();

    const restored = Doc.load(restoredBytes!);
    const after = restored.fingerprint();

    expect(bytesEqual(before, after)).toBe(true);

    const items = JSON.parse(restored.itemsInListJson(LIST_MAIN, false));
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(itemId);
    expect(items[0].text).toBe("buy milk");
  });

  test("getDoc on empty storage returns null", async () => {
    const storage = new MemStorage();
    expect(await storage.getDoc()).toBeNull();
    expect(await storage.getDevice()).toBeNull();
  });

  test("clear wipes both doc and device", async () => {
    const storage = new MemStorage();
    await storage.putDoc(new Uint8Array([1, 2, 3]));
    await storage.putDevice({
      accountId: "acct-1",
      email: "user@example.com",
      serverUrl: "http://localhost:8080",
      deviceId: "dev-1",
      lastAckedOpId: 0,
      lastSyncAt: null,
    });
    await storage.clear();
    expect(await storage.getDoc()).toBeNull();
    expect(await storage.getDevice()).toBeNull();
  });

  test("seeded built-in lists are present after create", () => {
    const doc = Doc.create();
    const lists = JSON.parse(doc.allListsJson()) as Array<{
      id: string;
      name: string;
    }>;
    // `main` is a reserved id, not a MovableList entry — only "Later"
    // is seeded as a real list.
    expect(lists.some((l) => l.id === LIST_MAIN)).toBe(false);
    expect(lists.map((l) => l.name)).toContain("Later");
  });
});

describe("Dek round trip", () => {
  test("generate → toHex → fromHex preserves bytes", () => {
    const a = Dek.generate();
    const hex = a.toHex();
    expect(hex).toHaveLength(64);
    const b = Dek.fromHex(hex);
    expect(b.toHex()).toBe(hex);
  });
});

describe("Op stream round trip via two replicas", () => {
  test("replica B converges to A's fingerprint after applying A's blob", () => {
    const dek = Dek.generate();

    const a = Doc.create();
    // Built-in seeds count as pending until we mark them pushed.
    const seedBlob = a.pendingExport(dek);
    expect(seedBlob).toBeDefined();
    a.markPushed();

    const itemId = a.addItem(LIST_MAIN, "from A");
    const opBlob = a.pendingExport(dek);
    expect(opBlob).toBeDefined();
    a.markPushed();

    // B starts empty and replays everything.
    const b = Doc.empty();
    b.applyRemote(dek, seedBlob!);
    b.applyRemote(dek, opBlob!);

    expect(bytesEqual(a.fingerprint(), b.fingerprint())).toBe(true);

    const items = JSON.parse(b.itemsInListJson(LIST_MAIN, false));
    expect(items.find((i: { id: string }) => i.id === itemId)).toBeDefined();
  });

  test("EncryptedBlob constructor + getters are symmetric", () => {
    const nonce = new Uint8Array(24).fill(7);
    const ciphertext = new Uint8Array([1, 2, 3, 4, 5]);
    const blob = new EncryptedBlob(nonce, ciphertext);
    expect(bytesEqual(blob.nonce, nonce)).toBe(true);
    expect(bytesEqual(blob.ciphertext, ciphertext)).toBe(true);
  });
});
