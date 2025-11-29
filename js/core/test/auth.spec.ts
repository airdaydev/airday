import { test, expect } from "bun:test";
import { createUser, updateUser } from "../src/index";
import { getRoot } from "../src/index";
import {
  createCore,
  createAuthenticatedCore,
  extractCookie,
  parseCookieValue,
} from "./utils";

test.only("API root url & version", async () => {
  const core = createCore();
  const d = await getRoot(core.apiUrl);
  expect(typeof d.data.version).toBe("string");
});

// test("non-existent username & password", async () => {
//   const core = await createAuthenticatedCore();
//   await core
//     .loginWithPasswordBearer({
//       email: "nope@nope.com",
//       password: "1234",
//     })
//     .catch((d) => {
//       expect(d.status).toBe(400);
//     });
// });

// test("Creating a user & default library", async () => {
//   const core = await createAuthenticatedCore();
//   const res = await createUser(core, {
//     email: "doubleup@air.day",
//     password: "fa09j20fiaj3fpaof",
//   });
//   expect(typeof res.data.id).toBe("string");
//   expect(res.data.id.length).toBe(36);
//   expect(res.data.primary_library.id).toHaveLength(36);
//   expect(typeof res.data.primary_library.name).toBe("string");

//   // Can't create another user with the same email
//   expect(
//     createUser(core, {
//       email: "doubleup@air.day",
//       password: "fa09j20fiaj3fpaof",
//     }),
//   ).rejects.toThrow();

//   // Can't create a user without a password
//   expect(
//     createUser(core, {
//       email: "newtest@air.day",
//     }),
//   ).rejects.toThrow();
// });

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

// test("Bearer authorisation & refreshing sessions with bearer tokens", async () => {
//   const core = await createAuthenticatedCore();
//   const email = "daniel-pw@air.day";
//   const password = "fa09j20fiaj3fpaof";
//   await createUser(core, {
//     email,
//     password,
//   });
//   expect(
//     core.loginWithPasswordBearer({
//       email,
//       password: "hi",
//     }),
//     "Rejects bad passwords",
//   ).rejects.toThrow();
//   const res = await core.loginWithPasswordBearer({
//     email,
//     password,
//   });
//   expect(core.session?.expires instanceof Date).toBe(true);
//   expect(core.session?.refreshExpires instanceof Date).toBe(true);
//   expect(typeof core.session?.token).toBe("string");
//   expect(typeof core.session?.refreshToken).toBe("string");
//   expect(typeof core.session?.userId).toBe("string");
//   const firstToken = core.session?.token;
//   const firstRefreshToken = core.session?.refreshToken;
//   // TODO: Use another route
//   // const session = await getJMAPSession(core);
//   // expect(session.response.status).toBe(200);
//   expect(core.session?.token?.length, "Valid session token").toBe(27);
//   expect(core.session?.refreshToken?.length, "Valid refresh token").toBe(27);
//   const refresh = await core.refreshBearer();
//   expect(refresh.response.status, "refresh api call succeeded").toBe(200);
//   expect(refresh.data.token, "core set refresh token").toBe(
//     core.session?.token as string,
//   );
//   expect(core.session?.token, "core token has rotated after refresh").not.toBe(
//     firstToken as string,
//   );
//   expect(refresh.data.refreshToken, "refresh token has set from api call").toBe(
//     core.session?.refreshToken as string,
//   );
//   expect(core.session?.refreshToken, "refresh token has rotated").not.toBe(
//     firstRefreshToken as string,
//   );
// });
