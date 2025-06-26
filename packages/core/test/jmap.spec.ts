import { expect, test, beforeAll } from "bun:test";
import { getJMAPSession } from "../src/index";
import { authenticateClient, createBearerClient } from "./utils.spec";

const client = createBearerClient();

beforeAll(async () => {
  await authenticateClient(client, "jmap@airday.com");
});

test("Get JMAP Session", async () => {
  const session = await getJMAPSession(client);
});
