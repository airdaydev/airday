import { expect, test } from "bun:test";
import { loadToml, validateConfig } from "toml-config";
import { AirdayClient, AuthMode } from "../index";
import { createUser } from "../src/user";
import { getRoot } from "../src/root";
import { extractCookie, parseCookieValue } from "./utils.spec";
import { getSession } from "../src/jmap";

const schema = {
  API_URL: { type: "string" },
} as const;

const rawConfig = loadToml(import.meta.url, "../config.toml");
export const config = validateConfig(schema, rawConfig);

const client = new AirdayClient({
  rootUrl: config.API_URL,
  authMode: AuthMode.BearerToken,
});

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

test("Cookie authorisation", async () => {
  // const sessionSetCookie = extractCookie(res.response.headers, "session_token");
  // const sessionToken = parseCookieValue(sessionSetCookie, "session_token");
  // expect(sessionToken).toBeTypeOf("string");
  // expect(sessionToken, "Session id key correct").toBeTruthy();
  // expect(sessionToken.length, "Returns valid session id").toBe(27);
  // const refreshSetCookie = extractCookie(res.response.headers, "refresh_token");
  // const refreshToken = parseCookieValue(refreshSetCookie, "refresh_token");
  // expect(refreshToken).toBeTypeOf("string");
  // expect(refreshToken, "Refresh token correct").toBeTruthy();
  // expect(refreshToken.length, "Returns valid refresh token").toBe(27);
  // expect(refreshToken).not.toBe(sessionToken);
});

test.only("Bearer authorisation", async () => {
  const email = "daniel-pw@air.day";
  const password = "fa09j20fiaj3fpaof";
  await createUser(client, {
    email,
    password,
  });
  expect(
    client.loginWithPasswordBearer({
      email,
      password: "hi",
    }),
    "Rejects bad passwords",
  ).rejects.toThrow();
  const res = await client.loginWithPasswordBearer({
    email,
    password,
  });
  expect(client.session?.expires instanceof Date).toBeTrue();
  expect(client.session?.refreshExpires instanceof Date).toBeTrue();
  expect(client.session?.token).toBeTypeOf("string");
  expect(client.session?.refreshToken).toBeTypeOf("string");
  expect(client.session?.userId).toBeTypeOf("string");
  const firstToken = client.session?.token;
  const firstRefreshToken = client.session?.refreshToken;
  const session = await getSession(client);
  expect(session.response.status).toBe(200);
  expect(client.session?.token?.length, "Valid session token").toBe(27);
  expect(client.session?.refreshToken?.length, "Valid refresh token").toBe(27);
  const refresh = await client.refreshBearer();
  expect(refresh.response.status, "refresh api call succeeded").toBe(200);
  expect(refresh.data.token, "client set refresh token").toBe(
    client.session?.token as string,
  );
  expect(
    client.session?.token,
    "client token has rotated after refresh",
  ).not.toBe(firstToken as string);
  expect(refresh.data.refreshToken, "refresh token has set from api call").toBe(
    client.session?.refreshToken as string,
  );
  expect(client.session?.refreshToken, "refresh token has rotated").not.toBe(
    firstRefreshToken as string,
  );
});
