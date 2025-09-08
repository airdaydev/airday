import { expect, test } from "@playwright/test";
import { AirdayItem } from "../src/sync/item";
import { createTestCore } from "./utils";
import { Uuidv4 } from "../src/common/uuid";
import { Builder } from "flatbuffers";

const core = createTestCore();

test("Create, encode & decode sync object", async () => {
  const library = new Uuidv4();
  const item = new AirdayItem({
    libraryId: library,
  });
  item.updateText("hello");
  item.updateText("again");
  expect(item.attributes.getById(0)?.data).toBe("again");
  expect(item.dirtyAttrs.size).toBe(1);

  const builder = new Builder();
  item.attributes.toFlatBuffer(builder);
});
