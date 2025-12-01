import { test, expect } from "bun:test";
import { createUser, updateUser } from "../src/index";
import { getRoot } from "../src/index";
import {
  createCore,
  createAuthenticatedCore,
  extractCookie,
  parseCookieValue,
} from "./utils";
import { BearerAuth } from "../src/auth/bearer";
import { Uuidv4 } from "../src/common/uuid";

test("API root url & version", async () => {
  const core = createCore();
  const d = await getRoot(core.apiUrl);
  expect(typeof d.data.version).toBe("string");
});

test("non-existent username & password", async () => {
  const core = createCore();
  await core.auth
    .passwordAuth({
      email: "nope@nope.com",
      password: "1234",
    })
    .catch((d) => {
      expect(JSON.parse(d.message).error).toBe("User not found");
      expect(d.status).toBe(400);
    });
});

test("Creating a user & default library", async () => {
  const core = await createAuthenticatedCore("defaultlib@air.day");
  const doubledEmail = "doubleup2@air.day";
  const res = await createUser(core.apiUrl, {
    email: doubledEmail,
    password: "fa09j20fiaj3fpaof",
  });
  expect(typeof res.data.id).toBe("string");
  expect(res.data.id.length).toBe(36);
  expect(res.data.primary_library.id).toHaveLength(36);
  expect(typeof res.data.primary_library.name).toBe("string");

  // Can't create another user with the same email
  expect(
    createUser(core.apiUrl, {
      email: doubledEmail,
      password: "fa09j20fiaj3fpaof",
    }),
  ).rejects.toThrow();

  // Can't create a user without a password
  expect(
    createUser(core.apiUrl, {
      email: "newtest@air.day",
    }),
  ).rejects.toThrow();
});

// test.skip("Cookie authorisation", async () => {
//   // const sessionSetCookie = extractCookie(res.response.headers, "session_token");
//   // const sessionToken = parseCookieValue(sessionSetCookie, "session_token");
//   // expect(sessionToken).toBeTypeOf("string");
//   // expect(sessionToken, "Session id key correct").toBeTruthy();
//   // expect(sessionToken.length, "Returns valid session id").toBe(27);
//   // const refreshSetCookie = extractCookie(res.response.headers, "refresh_token");
//   // const refreshToken = parseCookieValue(refreshSetCookie, "refresh_token");
//   // expect(refreshToken).toBeTypeOf("string");
//   // expect(refreshToken, "Refresh token correct").toBeTruthy();
//   // expect(refreshToken.length, "Returns valid refresh token").toBe(27);
//   // expect(refreshToken).not.toBe(sessionToken);
// });

test("Real account, bad password", async () => {
  const core = createCore();
  const email = "real-acc@air.day";
  const password = "fa09j20fiaj3fpaof";
  await createUser(core.apiUrl, {
    email,
    password,
  });
  expect(
    core.auth.passwordAuth({
      email,
      password: "hi",
    }),
    "Rejects bad passwords",
  ).rejects.toThrow();
});

test("Bearer authorisation", async () => {
  const core = createCore();
  const email = "daniel-pw@air.day";
  const password = "fa09j20fiaj3fpaof";
  await createUser(core.apiUrl, {
    email,
    password,
  });
  await core.auth.passwordAuth({
    email,
    password,
  });
  const bearerAuth = core.auth as BearerAuth;
  expect(bearerAuth.sessionExpiry instanceof Date).toBe(true);
  expect(typeof bearerAuth.sessionToken).toBe("string");
  expect(typeof bearerAuth.refreshToken).toBe("string");
  expect(bearerAuth.sessionData?.userId instanceof Uuidv4).toBeTrue();
});

test("Bearer refresh", async () => {
  const core = await createAuthenticatedCore("bearer-refresh@air.day");
  const bearerAuth = core.auth as BearerAuth;
  const ogToken = bearerAuth.sessionToken;
  const ogRefreshToken = bearerAuth.refreshToken;
  await bearerAuth.refreshBearer();
  const newToken = bearerAuth?.sessionToken;
  const newRefreshToken = bearerAuth.refreshToken;
  expect(ogToken).not.toBe(newToken);
  expect(ogRefreshToken).not.toBe(newRefreshToken);
});

test.todo("Automatic bearer refresh", () => {});
