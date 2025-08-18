// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3002";

export default defineConfig({
  use: {
    ...devices["Desktop Firefox"],
    baseURL,
  },
  webServer: {
    command: "pnpm run fe_test_server",
    url: baseURL,
    reuseExistingServer: false,
  },
});
