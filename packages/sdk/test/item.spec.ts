import { expect, test, beforeAll } from "bun:test";
import { authenticateClient, createBearerClient } from "./utils.spec";
import { ItemClient, AirdayItem, addItemAction } from "../src/index";

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
  const action = addItemAction(newItem);
  // itemClient.enqueueBatch([action]);
});
