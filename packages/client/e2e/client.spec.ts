import { expect, test } from "bun:test";
import { loadToml, validateConfig } from "toml-config";
import { AirdayClient } from "../index";
import { createUser, passwordAuth } from "../domain/user";
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

test("createUser", async () => {
  const res = await createUser(client, {
    email: "daniel@air.day",
    password: "fa09j20fiaj3fpaof",
  });
  expect(res.data.id).toBeTypeOf("string");
  expect(res.data.id.length).toBe(36);
});

test("passwordAuth", async () => {
  const res = await passwordAuth(client, {
    email: "daniel@air.day",
    password: "fa09j20fiaj3fpaof",
  });
  const setCookieHeader0 = res.response.headers.getSetCookie()[0];
  const kv = setCookieHeader0.split(`;`).shift();
  expect(kv).toBeTypeOf("string");
  expect(kv?.includes("session_id="), "Session id should be set").toBeTrue();
  expect((kv as string).length).toBe("session_id=".length + 27);
});
