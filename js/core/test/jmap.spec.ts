import { expect, test } from "@playwright/test";
import { getJMAPSession } from "../src/index";
import { authenticate, createTestCore } from "./utils.spec";

test("Get JMAP Session", async () => {
  const core = createTestCore();
  await authenticate(core, "jmap@airday.com");
  await getJMAPSession(core);
  // TODO: Expect what? but also just delete all this shit
});
