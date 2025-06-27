import { expect, test, beforeAll } from "bun:test";
import { authenticateClient, createBearerClient } from "./utils.spec";
import { SyncClient, AirdayItem } from "../src/index";
import { AirdayIDB } from "../src/storage/idb";

const client = createBearerClient();
const syncClient = new SyncClient(client);

beforeAll(async () => {
  await authenticateClient(client, `${Math.random()}@airday.com}`);
});

// TODO: test to ensure item is created server side before client update

test("Item sync", async () => {
  const newItem = new AirdayItem({
    id: "string",
    text: syncClient.lww.from("test item"),
  });
  const action = addItemAction(newItem);
  syncClient.subscribe((test) => {
    console.log(test);
  });
  syncClient.enqueueActions([action]);
});

test.only("idb mock test", async () => {
  const db = new AirdayIDB();
  const connect = await db.connect();
});
