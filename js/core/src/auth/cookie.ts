import { TypeOf } from "suretype";
import { passwordAuthSchema } from "../http/types";
import { AuthAdapter, AuthState } from "./adapter";
import { passwordAuthCookie, refreshCookie } from "../http/auth";
import { Uuidv4 } from "../common/uuid";

interface CookieSessionData {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
  sessionExp: Date;
}

export class CookieAuth extends AuthAdapter {
  readonly apiUrl: URL;
  requestCredentials: RequestCredentials = "include";
  state: AuthState = AuthState.Uninitialised;
  constructor(apiUrl: URL) {
    super();
    this.apiUrl = apiUrl;
  }
  requestHeaders(json: boolean = true): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
    return headers;
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
