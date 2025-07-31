// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";

const baseURL = "http://127.0.0.1:3002";

export default defineConfig({
  use: {
    // Use Firefox as default for all tests
    ...devices["Desktop Firefox"],
    baseURL,
  },
  webServer: {
    command: "bunx serve -l 3002",
    url: baseURL,
    reuseExistingServer: false,
  },
  // ... other config
});
