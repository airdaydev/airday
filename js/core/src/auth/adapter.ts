import { TypeOf } from "suretype";
import { passwordAuthSchema } from "../http/types";
import { SessionLike, SessionState } from "./types";
import { AuthenticateAction } from "../sync/fb";
import { EventEmitter } from "../common/events";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function getExpiryDelayMs(expiry: Date) {
  const now = Date.now();
  const expiryMs = expiry.getTime();
  const delay = expiryMs - now - REFRESH_BUFFER_MS;
  return delay;
}

export interface AdapterEventMap {
  session: SessionState;
}

export abstract class AuthAdapter {
  readonly apiUrl: URL;
  requestCredentials: RequestCredentials = "omit";
  events = new EventEmitter<AdapterEventMap>();
  constructor(apiUrl: URL) {
    this.apiUrl = apiUrl;
  }
  wsAuthMsg(): false | AuthenticateAction {
    return false;
  }
  abstract attemptBoot(sessionLike: SessionLike): Promise<void>;
  abstract requestHeaders(json?: boolean): Record<string, string>;
  abstract passwordAuth(
    opts: TypeOf<typeof passwordAuthSchema.schema>,
  ): Promise<void>;
  abstract signout(): void;
}
