// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";

export default defineConfig({
  use: {
    // Use Firefox as default for all tests
    ...devices["Desktop Firefox"],
  },
  // ... other config
});
