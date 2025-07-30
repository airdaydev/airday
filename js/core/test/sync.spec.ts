import { test, beforeAll, afterAll, expect } from "bun:test";
import { authenticate, createTestCore } from "./utils.spec";
import { LWWRegisterString } from "../src/crdt/lww";
import { AirdayItem } from "../src";
import { tracer } from "../src/tracer";

const core = createTestCore();

beforeAll(async () => {
  await authenticate(core, `${Math.random()}@airday.com}`);
  await core.db.connect();
  core.sync.setDB(core.db); // TODO: This should happen automatically
});

// TODO Test bulk sync
test("Item sync", async () => {
  core.ws.connect();
  // TODO: We shouldn't need async here... or we have to use same access pattern in app
  await new Promise((resolve) => {
    if (core.ws.authorised) return resolve(null);
    core.ws.events.on("authenticated", resolve);
  });
  // TODO: in mem item cache!
  const newItem = new AirdayItem({
    libraryId: core.library.id!,
    attributes: {
      text: LWWRegisterString.fromString("test"),
    },
  });
  let action = core.sync.createItem(newItem);
  const pending = core.sync.pendingActions.get(action.id.toHex());
  expect(pending?.id).toBe(action.id);
  await new Promise((resolve) => {
    core.ws.events.once("ack", (data) => {
      console.log(data);
      core.ws.close();
      resolve(null);
    });
  });
  expect(core.sync.pendingActions.size).toBe(0);
  const item = (
    await core.db.item.getItemsByLibrary(core.library.id!.toHex())
  )[0];
  expect(item.libraryId.toHex()).toBe(core.library.id!.toHex());
  expect(item.lastSync, "Item timestamps = considered sync").toBeGreaterThan(
    item.lastModified,
  );
});

afterAll(async () => {
  console.log("Flushing traces");
  await tracer.flushNow();
});
