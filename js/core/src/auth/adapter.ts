export enum AuthState {
  Uninitialised = "uninitialised",
  Local = "local",
  Online = "online",
  Anon = "anon",
}

export abstract class AuthAdapter {
  abstract credentials: RequestCredentials;
  abstract state: AuthState;
  abstract headers: (json?: boolean) => Record<string, string>;
}
