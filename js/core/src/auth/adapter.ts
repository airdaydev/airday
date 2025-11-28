import { EventEmitter } from "../common/events";

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
  abstract loadAuthState(): Promise<boolean>;
  abstract clearAuthState(): Promise<void>;
  abstract signout(): void;
}
