import "./localstorage-polyfill";
import { loadToml, validateConfig } from "toml-config";
import { AirdayCore } from "../src/index";
import { createUser } from "../src/index";
import { AirdayMemStorage } from "../src/storage/mem";
import { BearerAuth } from "../src/auth/bearer";

const TEST_RUN_ID = process.env.TEST_RUN_ID || Date.now();
export const testEmail = (name: string) =>
  `${name}.test_${TEST_RUN_ID}@air.day`;

export function extractCookie(
  headers: Headers,
  cookieName: string,
): string | undefined {
  return headers
    .getSetCookie()
    .find((cookieEntry) => cookieEntry.includes(cookieName));
}

export function parseCookieValue(
  cookieString: string | undefined,
  cookieName: string,
): string {
  if (!cookieString) {
    throw new Error(`Cookie ${cookieName} not found`);
  }
  const kv = cookieString.split(`;`).shift();
  if (!kv) {
    throw new Error(`Invalid cookie format for ${cookieName}`);
  }
  const cookieMatch = kv.match(new RegExp(`^${cookieName}=(.+)`));
  if (!cookieMatch || !cookieMatch[1]) {
    throw new Error(`Could not parse ${cookieName} value`);
  }
  return cookieMatch[1];
}

const schema = {
  api_url: { type: "string" },
  paseto_pk: { type: "string" },
} as const;

const rawConfig = loadToml(import.meta.url, "../config.toml");
export const config = validateConfig(schema, rawConfig);

export function createCore() {
  const apiUrl = new URL(config.api_url);
  const bearer = new BearerAuth(apiUrl, config.paseto_pk);
  const core = new AirdayCore({
    apiUrl: apiUrl,
    storageAdapter: new AirdayMemStorage(),
    authAdapter: bearer,
  });
  return core;
}

export async function createAuthenticatedCore(email: string) {
  const apiUrl = new URL(config.api_url);
  const bearer = new BearerAuth(apiUrl, config.paseto_pk);
  const core = new AirdayCore({
    apiUrl: apiUrl,
    storageAdapter: new AirdayMemStorage(),
    authAdapter: bearer,
  });
  const password = "fa09j20fiaj3fpaof";
  await createUser(core.apiUrl, {
    email,
    password,
  });
  // await core.init();
  await core.auth.passwordAuth({ email, password });
  return core;
}
