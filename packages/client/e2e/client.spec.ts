import { expect, test } from "bun:test";
import { loadToml, validateConfig } from "toml-config";
import { AirdayClient } from "../index";
import { createUser } from "../domain/user";
import { getRoot } from "../domain/root";

const schema = {
  API_URL: { type: "string" },
} as const;

const rawConfig = loadToml(import.meta.url, "../config.toml");
export const config = validateConfig(schema, rawConfig);

const client = new AirdayClient(config.API_URL);

test("getAPIRoot", async () => {
  const d = await getRoot(client);
  expect(d.data.version).toBeTypeOf("string");
});

test.only("createUser", async () => {
  const d = await createUser(client, {
    email: "daniel@air.day",
    password: "fa09j20fiaj3fpaof",
  });
  expect(d.data.id).toBeTypeOf("string");
});
