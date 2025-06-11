import { expect, test } from "bun:test";
import { loadToml, validateConfig } from "toml-config";
import { AirdayClient } from "./index";

const schema = {
  API_URL: { type: "string" },
} as const;

const rawConfig = loadToml(import.meta.url, "./config.toml");
export const config = validateConfig(schema, rawConfig);

const client = new AirdayClient(config.API_URL);

test("getAPIRoot", async () => {
  const d = await client.getAPIRoot();
  expect(d).toHaveProperty("version");
});
