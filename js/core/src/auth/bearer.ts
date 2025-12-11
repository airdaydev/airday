import { ensure, TypeOf, v } from "suretype";
import { SESSION_STORAGE_KEY } from "./auth";
import { passwordAuthSchema } from "../http/types";
import { passwordAuthBearer, refreshBearer } from "../http/auth";
import { verifyToken } from "./token";
import { AuthAdapterV2 } from "./adapter";
import { SessionLike } from "./types";

export const storedBearerSessionSchema = v.object({
  type: v.string().const("bearer").required(),
  sessionToken: v.string().required(),
  refreshToken: v.string().required(),
});

export type BearerSession = TypeOf<typeof storedBearerSessionSchema>;

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class BearerV2 extends AuthAdapterV2 {
  // Constructor fields
  readonly publicKey: string;
  // Dynamic fields
  sessionToken?: string;
  refreshToken?: string;
  sessionExpiry?: Date;
  refreshExpiry?: Date;
  constructor(apiUrl: URL) {
    super(apiUrl);
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
  async attemptBoot(sessionLike: SessionLike) {
    const validated = ensure(storedBearerSessionSchema, sessionLike);
    await this.updateSession(validated);
  }
  async updateSession(session: BearerSession) {
    const [sessionTokenData, refreshTokenData] = await Promise.all([
      verifyToken(this.publicKey, session.sessionToken),
      verifyToken(this.publicKey, session.refreshToken),
    ]);
    this.sessionToken = session.sessionToken;
    this.refreshToken = session.refreshToken;
    this.sessionExpiry = sessionTokenData.expiry;
    this.refreshExpiry = refreshTokenData.expiry;
    this.persistSession(session);
  }
  persistSession(session: BearerSession) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }
  async refresh() {
    if (!this.refreshToken) {
      throw new Error("can't refresh without token");
    }
    // TODO: Failed refreshes, retries when offline
    const res = await refreshBearer(this.apiUrl, this.refreshToken);
    const session: BearerSession = {
      type: "remote",
      refreshToken: res.data.refresh_token,
      sessionToken: res.data.session_token,
    };
    await this.updateSession(session);
  }
  signout() {}
  async passwordAuth(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    // Retries when offline
    const res = await passwordAuthBearer(this.apiUrl, opts);
    const session: BearerSession = {
      type: "bearer",
      refreshToken: res.data.refresh_token,
      sessionToken: res.data.session_token,
    };
    await this.updateSession(session);
  }
}
