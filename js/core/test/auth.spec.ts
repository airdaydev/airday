import { test, expect } from "bun:test";
import { createUser } from "../src/index";
import { getRoot } from "../src/index";
import { createBearerCore, createAuthenticatedCore, testEmail } from "./utils";
import { BearerAdapter } from "../src/auth/bearer";
import { Uuidv4 } from "../src/common/uuid";
import { SessionType } from "../src/auth/types";

test("Unauthorised API root url & version", async () => {
  const core = createBearerCore();
  const d = await getRoot(core.apiUrl);
  expect(typeof d.data.version).toBe("string");
});

test("Anon offline user", () => {
  const core = createBearerCore();
  expect(core.session.type, "Uninitialised auth").toBe(SessionType.None);
  expect(core.session.state).toBeUndefined();
  core.session.anon();
  expect(core.session.type).toBe(SessionType.Local);
  expect(core.session.state!.userId instanceof Uuidv4).toBe(true);
  expect(core.session.state!.primaryLibraryId instanceof Uuidv4).toBe(true);
});

test("Boot offline user from local storage", async () => {
  const core = createBearerCore();
  core.session.anon();
  const core2 = createBearerCore();
  await core2.session.loadFromStorage();
  expect(
    core.session.state?.userId!.equals(core2.session.state?.userId!),
  ).toBeTrue();
  expect(
    core.session.state?.primaryLibraryId!.equals(
      core2.session.state?.primaryLibraryId!,
    ),
  ).toBeTrue();
  expect(core2.session.type).toBe(SessionType.Local);
});

test("Boot online user from local storage", async () => {
  const core = await createAuthenticatedCore(testEmail("boot_cache"));
  const core2 = createBearerCore();
  await core2.session.loadFromStorage();
  expect(
    core.session.state?.userId!.equals(core2.session.state?.userId!),
  ).toBeTrue();
  expect(
    core.session.state?.primaryLibraryId!.equals(
      core2.session.state?.primaryLibraryId!,
    ),
  ).toBeTrue();
  expect(core.session.type).toBe(SessionType.Remote);
});

test("non-existent username & password", async () => {
  const core = createBearerCore();
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

test("can't create user with same email", async () => {
  const core = createBearerCore();
  const doubledEmail = testEmail("doubled");
  await createUser(core.apiUrl, {
    email: doubledEmail,
    password: "fa09j20fiaj3fpaof",
  });
  expect(
    createUser(core.apiUrl, {
      email: doubledEmail,
      password: "fa09j20fiaj3fpaof",
    }),
  ).rejects.toThrow();
});

test("password and email required for sign up", async () => {
  const core = createBearerCore();
  expect(
    createUser(core.apiUrl, {
      email: testEmail("new_test"),
    }),
  ).rejects.toThrow();
});

test("User creation with bearer adapter", async () => {
  const core = createBearerCore();
  const creds = {
    email: testEmail("defaults"),
    password: "fa09j20fiaj3fpaof",
  };
  const user = await createUser(core.apiUrl, creds);
  const userId = Uuidv4.fromString(user.data.id);
  const libId = Uuidv4.fromString(user.data.primary_library.id);
  expect(userId.equals(libId)).toBeFalse();
  await core.session.auth.passwordAuth(creds);
  expect(core.session.type).toBe(SessionType.Remote);
  expect(core.session.state!.userId.equals(userId)).toBeTrue();
  expect(core.session.state!.primaryLibraryId.equals(libId)).toBeTrue();
  const bearerAuth = core.session.auth as BearerAdapter;
  expect(bearerAuth.sessionExpiry instanceof Date).toBe(true);
  expect(typeof bearerAuth.sessionToken).toBe("string");
  expect(typeof bearerAuth.refreshToken).toBe("string");
});

test("Real account, bad password", async () => {
  const core = createBearerCore();
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
