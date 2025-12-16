import { ensure, TypeOf, v } from "suretype";
import { passwordAuthSchema } from "../http/types";
import { passwordAuthBearer, refreshBearer } from "../http/auth";
import { verifyToken } from "./token";
import { AuthAdapter, getExpiryDelayMs } from "./adapter";
import { SessionLike } from "./types";
import { AuthenticateAction } from "../sync/fb";
import { SESSION_STORAGE_KEY } from "./auth";

export const storedBearerSessionSchema = v.object({
  type: v.string().const("bearer").required(),
  sessionToken: v.string().required(),
  refreshToken: v.string().required(),
});

export function persistBearerSession(session: BearerSession) {
  const serialised = JSON.stringify(session);
  localStorage.setItem(SESSION_STORAGE_KEY, serialised);
}

export type BearerSession = TypeOf<typeof storedBearerSessionSchema>;

export class BearerAdapter extends AuthAdapter {
  // Constructor fields
  readonly publicKey: string;
  // Dynamic fields
  sessionToken?: string;
  refreshToken?: string;
  sessionExpiry?: Date;
  refreshExpiry?: Date;
  // Refresh
  refreshTimer?: number;
  constructor(apiUrl: URL, publicKey: string) {
    super(apiUrl);
    this.publicKey = publicKey;
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
    // TODO: If refreshExpiry is finished, it's over
    this.scheduleRefresh(sessionTokenData.expiry);
    persistBearerSession(session);
    this.events.emit("session", {
      userId: sessionTokenData.userId,
      primaryLibraryId: sessionTokenData.primaryLibraryId,
    });
  }
  async refresh() {
    if (!this.refreshToken) {
      throw new Error("can't refresh without token");
    }
    // TODO: Failed refreshes, retries when offline
    const res = await refreshBearer(this.apiUrl, this.refreshToken);
    const session: BearerSession = {
      type: "bearer",
      refreshToken: res.data.refresh_token,
      sessionToken: res.data.session_token,
    };
    await this.updateSession(session);
  }
  signout() {
    // TODO: Just clear & delete localstorage
  }
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
  private scheduleRefresh(expiry: Date) {
    this.cancelScheduledRefresh();
    if (expiry) {
      const delay = getExpiryDelayMs(expiry);
      if (delay <= 0) {
        this.refresh(); // TODO: Catch?
      } else {
        this.refreshTimer = setTimeout(() => {
          this.refresh().catch(() => {});
        }, delay) as unknown as number; // TODO: Recall NodeJS version
      }
    }
  }
  private cancelScheduledRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }
  wsAuthMsg() {
    if (this.sessionToken) {
      return new AuthenticateAction(this.sessionToken);
    }
    return false;
  }
}
