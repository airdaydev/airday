import { expect, test } from "bun:test";
import { loadToml, validateConfig } from "toml-config";

const schema = {
  API_URL: { type: "string" },
} as const;

const rawConfig = loadToml(import.meta.url, "./config.toml");
export const config = validateConfig(schema, rawConfig);

test("Correct url for testing", () => {
  expect(config.API_URL).toBe("http://localhost:8000");
});
