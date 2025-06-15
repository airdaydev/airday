import { expect, test } from "bun:test";
import { loadToml, validateConfig } from "toml-config";
import { AirdayClient } from "../index";
import { createUser, passwordAuth } from "../domain/user";
import { getRoot } from "../domain/root";
import { extractCookie, parseCookieValue } from "./utils.spec";

const schema = {
  API_URL: { type: "string" },
} as const;

const rawConfig = loadToml(import.meta.url, "../config.toml");
export const config = validateConfig(schema, rawConfig);

const client = new AirdayClient({ rootUrl: config.API_URL });

test("API root url & version", async () => {
  const d = await getRoot(client);
  expect(d.data.version).toBeTypeOf("string");
});

test("Creating a user", async () => {
  const res = await createUser(client, {
    email: "daniel@air.day",
    password: "fa09j20fiaj3fpaof",
  });
  expect(res.data.id).toBeTypeOf("string");
  expect(res.data.id.length).toBe(36);
  expect(
    createUser(client, {
      email: "daniel@air.day",
      password: "fa09j20fiaj3fpaof",
    }),
    "Can't create another user with the same email",
  ).rejects.toThrow();
  expect(
    createUser(client, {
      email: "daniel@air.day",
    }),
    "Can't create a user without a password",
  ).rejects.toThrow();
});

test.only("Authorisation flow", async () => {
  const email = "daniel-pw@air.day";
  const password = "fa09j20fiaj3fpaof";
  await createUser(client, {
    email,
    password,
  });
  expect(
    passwordAuth(client, {
      email,
      password: "hi",
    }),
    "Rejects bad passwords",
  ).rejects.toThrow();
  const res = await passwordAuth(client, {
    email,
    password,
  });
  const sessionSetCookie = extractCookie(res.response.headers, "session_token");
  const sessionToken = parseCookieValue(sessionSetCookie, "session_token");
  expect(sessionToken).toBeTypeOf("string");
  expect(sessionToken, "Session id key correct").toBeTruthy();
  expect(sessionToken.length, "Returns valid session id").toBe(27);
  const refreshSetCookie = extractCookie(res.response.headers, "refresh_token");
  const refreshToken = parseCookieValue(refreshSetCookie, "refresh_token");
  expect(refreshToken).toBeTypeOf("string");
  expect(refreshToken, "Refresh token correct").toBeTruthy();
  expect(refreshToken.length, "Returns valid refresh token").toBe(27);
  expect(refreshToken).not.toBe(sessionToken);
  client.setSessionToken(sessionToken);
});
