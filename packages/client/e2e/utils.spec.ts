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
