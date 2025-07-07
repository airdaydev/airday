import { expect, test, beforeAll } from "bun:test";
import { authenticateClient, createBearerClient } from "./utils.spec";
import { SyncClient, AirdayItem } from "../src/index";
import { AirdayIDB } from "../src/storage/idb";
import { AirdayItemSync } from "../src/tasks/sync";
import { WebsocketManager } from "../src/client/websocket";
import { LWWRegisterString } from "../src/crdt/lww";

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
    text: new LWWRegisterString({
      timestamp: syncClient.timestampProducer.timestamp(),
      data: "test",
    }),
  });
  airdayItemSync.createItem(newItem);
  client.ws.close();

  // syncClient.subscribe((test) => {
  //   expect(test.payload.id).toBe("string");
  // });
  // const t = await client.ws.send("type");
});
