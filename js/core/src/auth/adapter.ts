export enum AuthState {
  Uninitialised = "uninitialised",
  Loaded = "loaded",
  Anon = "anon",
}

export abstract class AuthAdapter {
  abstract credentials: RequestCredentials;
  abstract state: AuthState;
  abstract headers: (json?: boolean) => Record<string, string>;
  abstract loadAuthState: () => Promise<boolean>;
  abstract signout: () => void;
}
