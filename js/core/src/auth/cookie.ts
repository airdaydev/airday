import { TypeOf } from "suretype";
import { passwordAuthSchema } from "../http/types";
import { AuthAdapter, AuthState } from "./adapter";
import { passwordAuthCookie, refreshCookie } from "../http/auth";
import { Uuidv4 } from "../common/uuid";

interface CookieLocalStorageData {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
  sessionExp: Date;
  refreshExp: Date;
}

export class CookieAuth extends AuthAdapter {
  readonly apiUrl: URL;
  credentials: RequestCredentials = "include";
  state: AuthState = AuthState.Uninitialised;
  sessionData?: CookieLocalStorageData;
  constructor(apiUrl: URL) {
    super();
    this.apiUrl = apiUrl;
  }
  headers(json: boolean = true): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
    return headers;
  }
  initOpts(init: RequestInit) {
    init.credentials = "include";
  }
  async initAuthState() {
    return true;
  }
  async passwordAuth(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    await passwordAuthCookie(this.apiUrl, opts);
    return true;
  }
  async clearAuthState() {}
  signout() {}
  async refresh() {
    await refreshCookie(this.apiUrl);
  }
}
