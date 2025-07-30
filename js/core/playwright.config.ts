// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  globalSetup: path.resolve(__dirname, "./global-setup.ts"),
  use: {
    // Use Firefox as default for all tests
    ...devices["Desktop Firefox"],
  },
  // ... other config
});
