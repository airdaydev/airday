import { expect, test } from "@playwright/test";
import { authenticate, createTestCore } from "./utils.spec";
import { LWWRegisterString } from "../src/crdt/lww";
import { AirdayCore } from "../src";
import { tracer } from "../src/tracer";
import path from "path";

// TODO Test bulk sync
test("Item sync", async ({ page }) => {
  page.on("console", (msg) => {
    console.log(`🌐 Browser: ${msg.text()}`);
  });
  page.on("pageerror", (error) => {
    console.error(`❌ Page Error: ${error.message}`);
  });

  const msgs: string[] = [];
  page.exposeFunction("sendToPlaywright", (message) => {
    msgs.push("yo");
    return {};
  });

  const filePath = path.resolve("./test.html");
  await page.goto(`file://${filePath}`);

  await page.evaluate(() => {
    console.log("wtf", JSON.stringify(window.__TEST_RESULTS__));
  });
  console.log("msgs", msgs);
});
