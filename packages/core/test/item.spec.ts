import { expect, test, beforeAll } from "bun:test";
import { authenticateClient, createBearerClient } from "./utils.spec";
import { LWWRegisterString } from "../src/crdt/lww";

const client = createBearerClient();

beforeAll(async () => {
  await authenticateClient(client, `${Math.random()}@airday.com}`);
  await client.db.connect();
  client.sync.setDB(client.db); // TODO: This should happen automatically
});

test.only("Item sync", async () => {
  client.ws.connect();
  // client.ws.bearerAuth();
  // const newItem = new AirdayItem({
  //   text: new LWWRegisterString({
  //     timestamp: syncClient.timestampProducer.timestamp(),
  //     data: "test",
  //   }),
  // });
  // airdayItemSync.createItem(newItem);
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      client.ws.close();
      resolve(null);
    }, 3000);
  });

  // syncClient.subscribe((test) => {
  //   expect(test.payload.id).toBe("string");
  // });
  // const t = await client.ws.send("type");
});
