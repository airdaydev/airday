import { expect, test, beforeAll } from "bun:test";
import { getSession } from "../src/jmap";
import { authenticateClient, createBearerClient } from "./utils.spec";

const client = createBearerClient();

beforeAll(async () => {
  await authenticateClient(client, "jmap@airday.com");
});

// test.only("Get JMAP Session", async () => {
//   const session = await getSession(client);
//   console.log(session.data);
// });
