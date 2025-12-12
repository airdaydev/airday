// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://localhost:3002";

export default defineConfig({
  testDir: "./playwright",
  use: {
    ...devices["Desktop Firefox"],
    baseURL,
  },
  webServer: {
    command: "bunx serve -l 3002",
    url: baseURL,
    reuseExistingServer: false,
  },
});
