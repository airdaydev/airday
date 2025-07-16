import { test, beforeAll } from "bun:test";
import { authenticate, createTestCore } from "./utils.spec";
import { LWWRegisterString } from "../src/crdt/lww";
import { AirdayItem } from "../src";

const core = createTestCore();

beforeAll(async () => {
  await authenticate(core, `${Math.random()}@airday.com}`);
  await core.db.connect();
  core.sync.setDB(core.db); // TODO: This should happen automatically
});

test.only("Item sync", async () => {
  core.ws.connect();
  const newItem = new AirdayItem({
    text: LWWRegisterString.fromString("test"),
  });
  core.sync.createItem(newItem);
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      core.ws.close();
      resolve(null);
    }, 3000);
  });

  // syncClient.subscribe((test) => {
  //   expect(test.payload.id).toBe("string");
  // });
  // const t = await core.ws.send("type");
});
