import { ensure, TypeOf, v } from "suretype";
import { AuthAdapter, getExpiryDelayMs } from "./adapter";
import { passwordAuthCookie, refreshCookie } from "../http/auth";
import { passwordAuthSchema } from "../http/types";
import { Uuidv4 } from "../common/uuid";
import { SessionLike } from "./types";
import { SESSION_STORAGE_KEY } from "./auth";

export const storedCookieSession = v.object({
  type: v.string().const("cookie").required(),
  userId: v.string().required(),
  primaryLibraryId: v.string().required(),
  refreshExpiry: v.number().required(),
  sessionExpiry: v.number().required(),
});

export function persistCookieSession(session: CookieSession) {
  const serialised = JSON.stringify(session);
  localStorage.setItem(SESSION_STORAGE_KEY, serialised);
}

export type StoredCookieSession = TypeOf<typeof storedCookieSession>;

interface CookieSession {
  type: "cookie";
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
  refreshExpiry: Date;
  sessionExpiry: Date;
}

export class CookieAdapter extends AuthAdapter {
  requestCredentials: RequestCredentials = "include";
  sessionExpiry?: Date;
  refreshExpiry?: Date;
  refreshTimer?: number;
  requestHeaders(json: boolean = true): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
    return headers;
  }
  async attemptBoot(sessionLike: SessionLike) {
    const validated = ensure(storedCookieSession, sessionLike);
    const session: CookieSession = {
      type: "cookie",
      userId: Uuidv4.fromString(validated.userId),
      primaryLibraryId: Uuidv4.fromString(validated.primaryLibraryId),
      sessionExpiry: new Date(validated.sessionExpiry),
      refreshExpiry: new Date(validated.refreshExpiry),
    };
    // TODO: check if refresh expired?
    await this.updateSession(session);
  }
  async updateSession(session: CookieSession) {
    this.sessionExpiry = session.sessionExpiry;
    this.refreshExpiry = session.refreshExpiry;
    // TODO: Other things
    // TODO: If refreshExpiry is finished, it's over
    this.scheduleRefresh(session.sessionExpiry);
    persistCookieSession(session);
  }
  async passwordAuth(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    // Retries when offline
    const res = await passwordAuthCookie(this.apiUrl, opts);
    const session: CookieSession = {
      type: "cookie",
      userId: Uuidv4.fromString(res.data.user_id),
      primaryLibraryId: Uuidv4.fromString(res.data.primary_library_id),
      refreshExpiry: new Date(res.data.refresh_expires),
      sessionExpiry: new Date(res.data.expires),
    };
    await this.updateSession(session);
  }
  signout() {
    // TODO: Send sign out to server / mark as logged signout
    // TODO: We also need to not include credentials when not officially logged in even if cookie exists
  }
  async refresh() {
    // TODO: Failed refreshes, retries when offline
    const res = await refreshCookie(this.apiUrl);
    const session: CookieSession = {
      type: "cookie",
      userId: Uuidv4.fromString(res.data.user_id),
      primaryLibraryId: Uuidv4.fromString(res.data.primary_library_id),
      refreshExpiry: new Date(res.data.refresh_expires),
      sessionExpiry: new Date(res.data.expires),
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
}
