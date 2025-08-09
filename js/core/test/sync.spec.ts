import { expect, test } from "@playwright/test";

// TODO Test bulk sync
test.only("Item sync", async ({ page }) => {
  page.on("console", (msg) => {
    console.log(`🌐 Browser: ${msg.text()}`);
  });
  page.on("pageerror", (error) => {
    console.error(`❌ Page Error: ${error.message}`);
  });

  const msgs: any[] = [];
  page.exposeFunction("sendToPlaywright", (message) => {
    msgs.push(message);
  });

  await page.goto(`/test.html`);

  await page.evaluate(async () => {
    if (window.tests) await window.tests();
  });
  await page.close();
  console.log(msgs[0]);
  expect(msgs[0].failed, "No browser tests failing").toBe(0);
  expect(msgs[0].passed, "Browser tests passing").toBeGreaterThan(0);
});
