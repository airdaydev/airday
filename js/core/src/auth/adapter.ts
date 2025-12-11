import { TypeOf } from "suretype";
import { passwordAuthSchema } from "../http/types";
import { SessionLike } from "./types";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function getExpiryDelayMs(expiry: Date) {
  const now = Date.now();
  const expiryMs = expiry.getTime();
  const delay = expiryMs - now - REFRESH_BUFFER_MS;
  return delay;
}

export abstract class AuthAdapter {
  readonly apiUrl: URL;
  requestCredentials: RequestCredentials = "omit";
  constructor(apiUrl: URL) {
    this.apiUrl = apiUrl;
  }
  abstract attemptBoot(sessionLike: SessionLike): {};
  abstract requestHeaders(json?: boolean): Record<string, string>;
  abstract passwordAuth(
    opts: TypeOf<typeof passwordAuthSchema.schema>,
  ): Promise<void>;
  abstract signout(): void;
}
