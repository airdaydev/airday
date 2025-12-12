import { test, expect } from "bun:test";
import { createUser } from "../src/index";
import { getRoot } from "../src/index";
import {
  createCore,
  createAuthenticatedCore,
  extractCookie,
  parseCookieValue,
  testEmail,
} from "./utils";
import { Uuidv4 } from "../src/common/uuid";
import { BearerAdapter } from "../src/auth/bearer";

test.only("Unauthorised API root url & version", async () => {
  const core = createCore();
  const d = await getRoot(core.apiUrl);
  expect(typeof d.data.version).toBe("string");
});

test("non-existent username & password", async () => {
  const core = createCore();
  await core.session.auth
    .passwordAuth({
      email: testEmail("nope"),
      password: "1234",
    })
    .catch((d) => {
      expect(JSON.parse(d.message).error).toBe("User not found");
      expect(d.status).toBe(400);
    });
});

test("Creating a user & default library", async () => {
  const core = await createAuthenticatedCore(testEmail("defaultlib"));
  const doubledEmail = testEmail("doubled");
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
      email: testEmail("new_test"),
    }),
  ).rejects.toThrow();
});

test("Real account, bad password", async () => {
  const core = createCore();
  const email = testEmail("realAcc");
  const password = "fa09j20fiaj3fpaof";
  await createUser(core.apiUrl, {
    email,
    password,
  });
  expect(
    core.session.auth.passwordAuth({
      email,
      password: "hi",
    }),
    "Rejects bad passwords",
  ).rejects.toThrow();
});

test("Bearer authorisation", async () => {
  const core = createCore();
  const email = testEmail("daniel_pw");
  const password = "fa09j20fiaj3fpaof";
  await createUser(core.apiUrl, {
    email,
    password,
  });
  await core.session.auth.passwordAuth({
    email,
    password,
  });
  const bearerAuth = core.session.auth as BearerAdapter;
  expect(bearerAuth.sessionExpiry instanceof Date).toBe(true);
  expect(typeof bearerAuth.sessionToken).toBe("string");
  expect(typeof bearerAuth.refreshToken).toBe("string");
  // expect(bearerAuth.sessionData?.userId instanceof Uuidv4).toBeTrue();
});

test("Bearer refresh", async () => {
  const core = await createAuthenticatedCore(testEmail("bearer_refresh"));
  const bearerAuth = core.session.auth as BearerAdapter;
  const ogToken = bearerAuth.sessionToken;
  const ogRefreshToken = bearerAuth.refreshToken;
  await bearerAuth.refresh();
  const newToken = bearerAuth?.sessionToken;
  const newRefreshToken = bearerAuth.refreshToken;
  expect(ogToken).not.toBe(newToken);
  expect(ogRefreshToken).not.toBe(newRefreshToken);
});

test.todo("Automatic bearer refresh", () => {});
test.todo("Expired session token but valid refresh token", () => {});
test.todo("Expired session & refresh tokens", () => {});
test.todo("Anon offline user", () => {});
