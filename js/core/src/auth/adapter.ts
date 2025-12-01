import { TypeOf } from "suretype";
import { EventEmitter } from "../common/events";
import { passwordAuthSchema } from "../http/types";
import { Uuidv4 } from "../common/uuid";

export const SESSION_STORAGE_KEY = "airday_session";

export interface SessionData {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
  type: "remote" | "local_only";
}

export enum AuthState {
  Uninitialised = "uninitialised",
  Remote = "remote",
  LocalOnly = "local_only",
  ExpiredSession = "expired_session",
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
  sessionExpiry?: Date;
  refreshExpiry?: Date;
  abstract state: AuthState;
  abstract requestHeaders(json?: boolean): Record<string, string>;
  abstract initAuthState(): Promise<void>;
  abstract clearAuthState(): Promise<void>;
  abstract passwordAuth(
    opts: TypeOf<typeof passwordAuthSchema.schema>,
  ): Promise<boolean>;
  abstract signout(): void;
}

export type LocalSession = {
  type: "local";
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
};

export function newLocalSession(): LocalSession {
  return {
    type: "local",
    userId: new Uuidv4(),
    primaryLibraryId: new Uuidv4(),
  };
}
