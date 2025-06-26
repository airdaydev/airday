import { expect, test, beforeAll } from "bun:test";
import { authenticateClient, createBearerClient } from "./utils.spec";
import { ItemClient } from "../src/item";

const client = createBearerClient();
const itemClient = new ItemClient(client);

beforeAll(async () => {
  await authenticateClient(client, `${Math.random()}@airday.com}`);
});

test("Item sync", async () => {
  const newItem = new AirdayItem({
    id: "string",
    text: itemClient.lww.from("test item"),
  });
  itemClient.enqueueBatch([newItem.createAction()]);
});
