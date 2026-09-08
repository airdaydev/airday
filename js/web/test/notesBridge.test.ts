import { expect, test } from "bun:test";

import { Dek, Doc, EncryptedBlob, SyncEngine } from "@airday/core/wasm";
import type { EngineStorage } from "@airday/core/wasm";
import { MemEngineStorage } from "../../core/test/mem-engine-storage.ts";
import { createSyncedApp } from "../src/sync/store.ts";

const DOC_ID = "00000000-0000-0000-0000-000000000000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The notes delta path bypasses `mutate`, so its durability rides on the
// store's idle timer: a burst of `applyNotesDelta` calls must become a
// captured WAL row without any other mutation or an explicit flush.
test("typed notes deltas are captured to the WAL on the idle timer", async () => {
  const dek = Dek.generate();
  const storage = new MemEngineStorage();
  const engine = new SyncEngine(
    Doc.create(),
    DOC_ID,
    dek.clone(),
    0n,
    "test",
    "0",
    storage as unknown as EngineStorage,
  );
  const app = createSyncedApp(engine);
  // Same wiring as `createWorkspaceRuntime`.
  app.setBeforeFlush(() => {
    engine.captureLocalOps();
  });

  const id = app.addItem("inbox", "item");
  const rowsAfterAdd = storage.ops.length;
  expect(rowsAfterAdd).toBeGreaterThan(0);

  expect(app.subscribeNotes(id)).toBe("");
  app.applyNotesDelta(id, [{ insert: "h" }]);
  app.applyNotesDelta(id, [{ retain: 1 }, { insert: "e" }]);
  app.applyNotesDelta(id, [{ retain: 2 }, { insert: "y" }]);
  // Store and search see it immediately; nothing captured yet.
  expect(app.state.itemsById[id]?.notes).toBe("hey");
  expect(storage.ops.length).toBe(rowsAfterAdd);

  await sleep(450);
  expect(storage.ops.length).toBe(rowsAfterAdd + 1);

  // The captured rows rebuild the notes on a fresh doc (what boot does).
  const fresh = Doc.empty();
  for (const op of storage.ops) {
    fresh.applyRemote(dek, new EncryptedBlob(op.nonce, op.ciphertext));
  }
  expect(JSON.parse(fresh.getItemJson(id) ?? "{}").notes).toBe("hey");

  // A follow-up burst is its own row; `flushNotes` runs it now.
  app.applyNotesDelta(id, [{ retain: 3 }, { insert: "!" }]);
  app.flushNotes();
  expect(storage.ops.length).toBe(rowsAfterAdd + 2);
  app.unsubscribeNotes(id);
});
