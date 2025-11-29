import { EventEmitter } from "../common/events";

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
  abstract credentials: RequestCredentials;
  abstract state: AuthState;
  abstract headers(json?: boolean): Record<string, string>;
  abstract initAuthState(): Promise<boolean>;
  abstract clearAuthState(): Promise<void>;
  abstract signout(): void;
}
