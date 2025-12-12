import { test, expect } from "@playwright/test";

const TEST_RUN_ID = Date.now();
const testEmail = (name: string) => `${name}.test_${TEST_RUN_ID}@air.day`;

test("Sign in with cookie", async ({ page }) => {
  page.on("console", (msg) => {
    console.log(`Browser: ${msg.text()}`);
  });
  page.on("pageerror", (error) => {
    console.error(`Page Error: ${error.message}`);
  });

  await page.goto("/test.html");

  const email = testEmail("cookie");
  const password = "abcdefg123";

  const result = await page.evaluate(
    async ({ email, password }) => {
      const { AirdayCore, createUser, AirdayIDBStorage, CookieAdapter } =
        window as any;

      const apiUrl = new URL("http://localhost:3000");
      const core = new AirdayCore({
        apiUrl,
        storageAdapter: new AirdayIDBStorage(),
        authAdapter: new CookieAdapter(apiUrl),
      });

      const user = await createUser(core.apiUrl, { email, password });
      return { success: true, user };
    },
    { email, password },
  );

  expect(result.success).toBe(true);
  expect(result.user).toBeDefined();
});
