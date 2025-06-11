import { expect, test } from "bun:test";
import { loadToml, validateConfig } from "toml-config";
import { AirdayClient, getAPIRoot, createUser } from "./index";

const schema = {
  API_URL: { type: "string" },
} as const;

const rawConfig = loadToml(import.meta.url, "./config.toml");
export const config = validateConfig(schema, rawConfig);

const client = new AirdayClient(config.API_URL);

test("getAPIRoot", async () => {
  const d = await getAPIRoot(client);
  expect(d.body.version).toBeTypeOf("string");
});

test("createUser", async () => {
  const d = await createUser(client, {
    email: "daniel@gormly.co",
    password: "fa09j20fiaj3fpaof",
  });
  console.log(d);
});
