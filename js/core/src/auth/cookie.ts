import { TypeOf } from "suretype";
import { passwordAuthSchema } from "../http/types";
import { AuthAdapter, AuthState } from "./adapter";
import { passwordAuthCookie, refreshCookie } from "../http/auth";
import { Uuidv4 } from "../common/uuid";

interface CookieSessionData {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
  sessionExp: Date;
  refreshExp: Date;
}

export class CookieAuth implements AuthAdapter {
  readonly apiUrl: URL;
  credentials: RequestCredentials = "include";
  state: AuthState = AuthState.Uninitialised;
  sessionData?: CookieSessionData;
  constructor(apiUrl: URL) {
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
  loadAuthState() {}
  async authWithPassword(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    const res = await passwordAuthCookie(this.apiUrl, opts);
    // this.sessionData = {
    //   id: res.data.id,
    //   expires: new Date(res.data.expires),
    //   refreshExpires: new Date(res.data.refreshExpires),
    //   userId: res.data.userId,
    // };
  }
  signout() {}
  async refresh() {
    const res = await refreshCookie(this.apiUrl);
  }
}
