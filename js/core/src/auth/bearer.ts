import { TypeOf, ensure, v } from "suretype";
import { passwordAuthBearer, refreshBearer } from "../http/auth";
import { passwordAuthSchema } from "../http/types";
import {
  AuthAdapter,
  AuthState,
  LocalSession,
  SESSION_STORAGE_KEY,
} from "./adapter";
import { verifyToken } from "./token";
import { Uuidv4 } from "../common/uuid";

export const bearerSessionData = v.anyOf([
  v.object({
    type: v.string().const("local"),
    userId: v.string().required(),
    primaryLibraryId: v.string().required(),
  }),
  v.object({
    type: v.string().const("remote"),
    sessionToken: v.string().required(),
    refreshToken: v.string().required(),
  }),
]);

type BearerSession = {
  type: "remote";
  sessionToken: string;
  refreshToken: string;
};

function validateSerialisedBearerSessionData(
  serialisedSessionData: string,
): BearerSession | LocalSession {
  const parsed = JSON.parse(serialisedSessionData);
  const validated = ensure(bearerSessionData, parsed);
  if (!validated) {
    throw new Error("Invalid session data");
  }
  if (validated.type === "remote") {
    return {
      type: "remote",
      sessionToken: validated.sessionToken,
      refreshToken: validated.refreshToken,
    } satisfies BearerSession;
  }
  if (validated.type === "local") {
    return {
      type: "local",
      primaryLibraryId: Uuidv4.fromString(validated.primaryLibraryId),
      userId: Uuidv4.fromString(validated.userId),
    } satisfies LocalSession;
  }
  throw new Error("bad session");
}

// TODO: Clean this up! Implement automatic refreshes
export class BearerAuth extends AuthAdapter {
  readonly apiUrl: URL;
  readonly publicKey: string;
  sessionToken?: string;
  refreshToken?: string;
  state: AuthState = AuthState.Uninitialised;
  constructor(apiUrl: URL, publicKey: string) {
    super();
    this.apiUrl = apiUrl;
    this.publicKey = publicKey;
  }
  persistSession(session: LocalSession | BearerSession) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }
  async setTokens(sessionToken: string, refreshToken: string) {
    try {
      this.sessionToken = sessionToken;
      this.refreshToken = refreshToken;
      const sessionRes = await verifyToken(this.publicKey, sessionToken);
      // TODO: If the sessionRes is bad we still need to give the refreshToken a chance
      const refreshRes = await verifyToken(this.publicKey, refreshToken);
      this.sessionExpiry = sessionRes.expiry;
      this.refreshExpiry = refreshRes.expiry;
      if (refreshRes.expiry.getTime() <= new Date().getTime()) {
        // TODO: Show user somehow!
        // TODO: This shouldn't actually revert to anon state!!
        throw new Error("Refresh token expired, reverting to anon");
      }
      const sessionData: TokenPersistence = {
        sessionToken,
        refreshToken,
      };
      this.sessionData = {
        userId: sessionRes.userId,
        primaryLibraryId: sessionRes.primaryLibraryId,
        type: "remote",
      };
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
      if (this.sessionExpiry.getTime() <= new Date().getTime()) {
        this.state = AuthState.ExpiredSession;
        this.refreshBearer();
      } else {
        this.state = AuthState.Remote;
        this.events.emit("authenticated", {});
      }
    } catch (err) {
      this.clearAuthState();
    }
  }
  async clearAuthState() {
    // TODO: Be specific about what this is
    this.events.emit("deauthenticated", {});
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.state = AuthState.LocalOnly;
  }
  async initAuthState() {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      this.clearAuthState();
      return;
    }
    try {
      const sessionData = validateSerialisedBearerSessionData(stored);
      switch (sessionData.type) {
        case "local": {
          this.sessionData = sessionData;
        }
        case "remote": {
          if (sessionData.sessionToken && sessionData.refreshToken) {
            await this.setTokens(
              sessionData.sessionToken,
              sessionData.refreshToken,
            );
          } else {
            this.clearAuthState();
          }
        }
      }
    } catch {
      this.clearAuthState();
    }
  }
  requestHeaders(json: boolean = true): Record<string, string> {
    if (!this.sessionToken) throw new Error("User is not authenticated");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.sessionToken}`,
    };
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
    return headers;
  }
  async passwordAuth(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    // Retries when offline
    const res = await passwordAuthBearer(this.apiUrl, opts);
    await this.setTokens(res.data.session_token, res.data.refresh_token);
    return true;
  }
  async refreshBearer() {
    if (!this.refreshToken) {
      throw new Error("can't refresh without token");
    }
    // TODO: Failed refreshes, retries when offline
    const res = await refreshBearer(this.apiUrl, this.refreshToken);
    await this.setTokens(res.data.session_token, res.data.refresh_token);
  }
  signout() {}
}
