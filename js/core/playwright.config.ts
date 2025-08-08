// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";

const baseURL = "http://localhost:3002";

export default defineConfig({
  use: {
    // Use Firefox as default for all tests
    ...devices["Desktop Firefox"],
    baseURL,
  },
  webServer: {
    command: "pnpm run fe_test_server",
    url: baseURL,
    reuseExistingServer: false,
  },
  // ... other config
});
