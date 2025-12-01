import { TypeOf, ensure, v } from "suretype";
import { Uuidv4 } from "../common/uuid";
import { passwordAuthBearer, refreshBearer } from "../http/auth";
import { passwordAuthSchema } from "../http/types";
import { AuthAdapter, AuthState, SESSION_STORAGE_KEY } from "./adapter";
import { verifyToken } from "./token";

export const bearerSessionData = v.object({
  sessionToken: v.string().required(),
  refreshToken: v.string().required(),
});

type TokenPersistence = TypeOf<typeof bearerSessionData>;

function validateSerialisedBearerSessionData(
  sessionData: string,
): TokenPersistence {
  const parsed = JSON.parse(sessionData);
  const validated = ensure(bearerSessionData, parsed);
  if (!validated) {
    throw new Error("Invalid session data");
  }
  return {
    sessionToken: validated.sessionToken,
    refreshToken: validated.refreshToken,
  };
}

export class BearerAuth extends AuthAdapter {
  readonly apiUrl: URL;
  readonly publicKey: string;
  sessionToken?: string;
  refreshToken?: string;
  sessionExpiry?: Date;
  refreshExpiry?: Date;
  state: AuthState = AuthState.Uninitialised;
  constructor(apiUrl: URL, publicKey: string) {
    super();
    this.apiUrl = apiUrl;
    this.publicKey = publicKey;
  }
  async setTokens(sessionToken: string, refreshToken: string) {
    try {
      this.sessionToken = sessionToken;
      this.refreshToken = refreshToken;
      const sessionRes = await verifyToken(this.publicKey, sessionToken);
      const refreshRes = await verifyToken(this.publicKey, refreshToken);
      this.sessionExpiry = sessionRes.expiry;
      this.refreshExpiry = refreshRes.expiry;
      const sessionData: TokenPersistence = {
        sessionToken,
        refreshToken,
      };
      this.sessionData = {
        userId: sessionRes.userId,
        primaryLibraryId: sessionRes.primaryLibraryId,
      };
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
      this.state = AuthState.Loaded;
      this.events.emit("authenticated", {});
    } catch (err) {
      this.clearAuthState();
    }
  }
  async clearAuthState() {
    this.events.emit("deauthenticated", {});
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.state = AuthState.Anon;
  }
  async initAuthState() {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      this.clearAuthState();
      return;
    }
    try {
      const { sessionToken, refreshToken } =
        validateSerialisedBearerSessionData(stored);
      await this.setTokens(sessionToken, refreshToken);
    } catch {
      this.clearAuthState();
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
    // TODO: Failed refreshes
    const res = await refreshBearer(this.apiUrl, this.refreshToken);
    await this.setTokens(res.data.session_token, res.data.refresh_token);
    return true;
  }
  signout() {}
}
