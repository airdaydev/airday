import { TypeOf } from "suretype";
import { EventEmitter } from "../common/events";
import { passwordAuthSchema } from "../http/types";

export const SESSION_STORAGE_KEY = "airday_session";

export enum AuthState {
  Uninitialised = "uninitialised",
  Loaded = "loaded",
  Anon = "anon",
}

interface WSEventMap {
  authenticated: {};
  deauthenticated: {};
}

export abstract class AuthAdapter {
  constructor() {}
  events = new EventEmitter<WSEventMap>();
  requestCredentials: RequestCredentials = "omit";
  abstract state: AuthState;
  abstract headers(json?: boolean): Record<string, string>;
  abstract initAuthState(): Promise<boolean>;
  abstract clearAuthState(): Promise<void>;
  abstract passwordAuth(
    opts: TypeOf<typeof passwordAuthSchema.schema>,
  ): Promise<boolean>;
  abstract signout(): void;
}
