import "fake-indexeddb/auto";
import { loadToml, validateConfig } from "toml-config";
import { AirdayCore, AuthMode } from "../src/index";
import { createUser } from "../src/index";

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
  API_URL: { type: "string" },
} as const;

const rawConfig = loadToml(import.meta.url, "../config.toml");
export const config = validateConfig(schema, rawConfig);

export function createBearerClient() {
  return new AirdayCore({
    rootUrl: config.API_URL,
    authMode: AuthMode.BearerToken,
  });
}

export async function authenticateClient(core: AirdayCore, email: string) {
  const password = "fa09j20fiaj3fpaof";
  await createUser(core, {
    email,
    password,
  });
  await core.loginWithPasswordBearer({ email, password });
  return core;
}
