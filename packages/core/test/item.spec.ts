import { expect, test, beforeAll } from "bun:test";
import { authenticateClient, createBearerClient } from "./utils.spec";
import { SyncClient, AirdayItem } from "../src/index";
import { AirdayIDB } from "../src/storage/idb";
import { AirdayItemSync } from "../src/model/item";
import { WebsocketManager } from "../src/client/websocket";

const client = createBearerClient();
const syncClient = new SyncClient(client);
const airdayItemSync = new AirdayItemSync(syncClient);

beforeAll(async () => {
  await authenticateClient(client, `${Math.random()}@airday.com}`);
  await client.db.connect();
  airdayItemSync.setDB(client.db);
});

test.only("Item sync", async () => {
  const newItem = new AirdayItem({
    id: "string",
    text: syncClient.lww.from("test item"),
  });

  airdayItemSync.createItem(newItem);

  syncClient.subscribe((test) => {
    expect(test.payload.id).toBe("string");
  });
  client.ws.send("hi");
});
