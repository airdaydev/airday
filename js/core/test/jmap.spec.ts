import { expect, test, beforeAll } from "bun:test";
import { getJMAPSession } from "../src/index";
import { authenticate, createTestCore } from "./utils.spec";

const core = createTestCore();

beforeAll(async () => {
  await authenticate(core, "jmap@airday.com");
});

test("Get JMAP Session", async () => {
  const session = await getJMAPSession(core);
});
