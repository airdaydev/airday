import { expect, test } from "bun:test";

import { Dek, Doc, SyncEngine } from "@airday/core/wasm";
import type { EngineStorage } from "@airday/core/wasm";
import { MemEngineStorage } from "../../core/test/mem-engine-storage.ts";
import { createSyncedApp } from "../src/sync/store.ts";

const DOC_ID = "00000000-0000-0000-0000-000000000000";

test("bulk bootstrap crosses the app boundary as one full resync", () => {
  const dek = Dek.generate();
  const source = Doc.create();
  source.addItemsAt(
    "main",
    Array.from({ length: 100 }, (_, i) => `bootstrap ${i}`),
    0,
  );
  const blob = source.pendingExport(dek);
  expect(blob).not.toBeNull();

  const target = Doc.empty();
  target.applyRemote(dek, blob!);
  const targetEngine = new SyncEngine(
    target,
    DOC_ID,
    dek.clone(),
    0n,
    "test",
    "0",
    new MemEngineStorage() as unknown as EngineStorage,
  );
  const first = targetEngine.popAppEvent();
  expect(first?.kind).toBe("fullResync");
  expect(targetEngine.popAppEvent()).toBeUndefined();

  // Recreate the same queued control event for the app-level assertion.
  const secondTarget = Doc.empty();
  secondTarget.applyRemote(dek, blob!);
  const engine = new SyncEngine(
    secondTarget,
    DOC_ID,
    dek.clone(),
    0n,
    "test",
    "0",
    new MemEngineStorage() as unknown as EngineStorage,
  );
  const app = createSyncedApp(engine);
  expect(Object.keys(app.state.itemsById)).toHaveLength(100);
  app.drainEvents();
  expect(Object.keys(app.state.itemsById)).toHaveLength(100);
  expect(app.state.listOpen.main).toHaveLength(100);
});
