import { test, beforeAll, afterAll } from "bun:test";
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
  // TODO: We shouldn't need async here... or we have to manage it
  await new Promise((resolve) => {
    if (core.ws.authorised) return resolve(null);
    core.ws.events.on("authenticated", resolve);
  });
  console.log("ws: authenticated!");
  // TODO: in mem item cache!
  const newItem = new AirdayItem({
    libraryId: core.library.id!,
    attributes: {
      text: LWWRegisterString.fromString("test"),
    },
  });
  core.sync.createItem(newItem);
  await new Promise((resolve, reject) => {
    // TODO: Flush and close!
    setTimeout(() => {
      console.log("awaiting one second (hack)");
      core.ws.close();
      resolve(null);
    }, 1000);
  });
  // TODO: Ensure item is now marked as synced & clean
  // get items from beginning
});

afterAll(async () => {
  console.log("Flushing traces");
  await tracer.flushNow();
});
