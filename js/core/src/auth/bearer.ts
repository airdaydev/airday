import { TypeOf } from "suretype";
import { Uuidv4 } from "../common/uuid";
import { passwordAuthBearer, refreshBearer } from "../http/auth";
import { passwordAuthSchema } from "../http/types";
import { AuthAdapter, AuthState, SESSION_STORAGE_KEY } from "./adapter";
import { verifyToken } from "./token";

interface BearerSessionData {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
  sessionToken: string;
  refreshToken: string;
}

export class BearerAuth extends AuthAdapter {
  readonly apiUrl: URL;
  readonly publicKey: string;
  sessionToken?: string;
  refreshToken?: string;
  sessionExpiry?: Date;
  state: AuthState = AuthState.Uninitialised;
  sessionData?: BearerSessionData;
  constructor(apiUrl: URL, publicKey: string) {
    super();
    this.apiUrl = apiUrl;
    this.publicKey = publicKey;
  }
  async setTokens(sessionToken: string, refreshToken: string) {
    this.sessionToken = sessionToken;
    this.refreshToken = refreshToken;
    const res = await verifyToken(this.publicKey, sessionToken);
    await verifyToken(this.publicKey, refreshToken);
    this.sessionExpiry = res.expiry;
    const sessionData: BearerSessionData = {
      sessionToken,
      refreshToken,
      userId: res.userId,
      primaryLibraryId: res.primaryLibraryId,
    };
    this.sessionData = sessionData;
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
    this.state = AuthState.Loaded;
  }
  async clearAuthState() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.state = AuthState.Anon;
  }
  async initAuthState(): Promise<boolean> {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      this.state = AuthState.Anon;
      return false;
    }
    // TODO: Validate saved data!
    try {
      const { sessionToken, refreshToken, userId, primaryLibraryId } =
        JSON.parse(stored) as BearerSessionData;
      await this.setTokens(sessionToken, refreshToken);
      this.state = AuthState.Loaded;
      return true;
    } catch {
      this.clearAuthState();
      return false;
    }
  }
  headers(json: boolean = true): Record<string, string> {
    if (!this.sessionToken) throw new Error("User is not authenticated");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.sessionToken}`,
    };
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
    return headers;
  }
  initOpts(init: RequestInit) {
    if (!init.headers) {
      init.headers = {};
    }
  }
  async passwordAuth(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    const res = await passwordAuthBearer(this.apiUrl, opts);
    await this.setTokens(res.data.session_token, res.data.refresh_token);
    return true;
  }
  async refreshBearer() {
    if (!this.refreshToken) {
      throw new Error("can't refresh without token");
    }
    const res = await refreshBearer(this.apiUrl, this.refreshToken);
    return false;
  }
  signout() {}
}
