import { expect, test } from "@playwright/test";
import { AirdayItem } from "../src/sync/item";
import { createTestCore } from "./utils";
import { Uuidv4 } from "../src/common/uuid";

const core = createTestCore();

test("Create, encode & decode sync object", async () => {
  const library = new Uuidv4();
  const item = new AirdayItem({
    libraryId: library,
  });
});
