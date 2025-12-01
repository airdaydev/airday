import { TypeOf } from "suretype";
import { EventEmitter } from "../common/events";
import { passwordAuthSchema } from "../http/types";
import { Uuidv4 } from "../common/uuid";

export const SESSION_STORAGE_KEY = "airday_session";

export interface SessionData {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
}

export enum AuthState {
  Uninitialised = "uninitialised",
  Loaded = "loaded",
  Anon = "anon",
}

export interface WSEventMap {
  authenticated: {};
  deauthenticated: {};
}

export abstract class AuthAdapter {
  constructor() {}
  events = new EventEmitter<WSEventMap>();
  requestCredentials: RequestCredentials = "omit";
  sessionData?: SessionData;
  abstract state: AuthState;
  abstract headers(json?: boolean): Record<string, string>;
  abstract initAuthState(): Promise<void>;
  abstract clearAuthState(): Promise<void>;
  abstract passwordAuth(
    opts: TypeOf<typeof passwordAuthSchema.schema>,
  ): Promise<boolean>;
  abstract signout(): void;
}
