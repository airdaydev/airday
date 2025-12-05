import { TypeOf, ensure, v } from "suretype";
import { passwordAuthBearer, refreshBearer } from "../http/auth";
import { passwordAuthSchema } from "../http/types";
import {
  AuthAdapter,
  AuthState,
  LocalSession,
  newLocalSession,
  SESSION_STORAGE_KEY,
  SessionData,
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

export function getInitialSession(): BearerSession | LocalSession {
  const stored = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!stored) {
    // No stored session found, create new offline user
    return newLocalSession();
  }
  try {
    const sessionData = validateSerialisedBearerSessionData(stored);
    return sessionData;
  } catch {
    // Invalid session storage found, return new anon user
    return newLocalSession();
  }
}

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

export class BearerAuth extends AuthAdapter {
  readonly apiUrl: URL;
  readonly publicKey: string;
  sessionToken?: string;
  refreshToken?: string;
  state: AuthState = AuthState.Uninitialised;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  constructor(apiUrl: URL, publicKey: string) {
    super();
    this.apiUrl = apiUrl;
    this.publicKey = publicKey;
  }
  persistSession(session: LocalSession | BearerSession) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
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
    // TODO: Check session expiry here!
    this.state = AuthState.Remote;
    const sessionData: SessionData = {
      type: "remote",
      userId: sessionTokenData.userId,
      primaryLibraryId: sessionTokenData.primaryLibraryId,
    };
    this.sessionData = sessionData;
    this.scheduleRefresh();
    return sessionData;
  }
  async refreshSession(session: BearerSession) {
    try {
      let sessionData = await this.updateSession(session);
      this.events.emit("refresh", sessionData);
    } catch (err) {
      console.error(err);
      // TODO: Refresh failed notification
    }
  }
  async bootSession(
    session: LocalSession | BearerSession,
  ): Promise<SessionData> {
    let sessionData: SessionData;
    if (this.state === AuthState.Initialising) {
      throw new Error("Attempted to boot concurrently. Stopping.");
    }
    this.state = AuthState.Initialising;
    switch (session.type) {
      case "local": {
        sessionData = session;
        this.sessionData = session;
        this.persistSession(session);
        this.state = AuthState.Local;
        this.events.emit("initialised", session);
        break;
      }
      case "remote": {
        try {
          sessionData = await this.updateSession(session);
          this.events.emit("initialised", sessionData);
        } catch (err) {
          // TODO: Session failure notification
          console.error(err);
          sessionData = this.newLocalSession();
          break;
        }
      }
    }
    return sessionData;
  }
  newLocalSession() {
    const session = newLocalSession();
    this.persistSession(session);
    this.state = AuthState.Local;
    this.sessionData = session;
    this.events.emit("initialised", session);
    return session;
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
    const session: BearerSession = {
      type: "remote",
      refreshToken: res.data.refresh_token,
      sessionToken: res.data.session_token,
    };
    await this.bootSession(session);
  }
  async refreshBearer() {
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
    await this.bootSession(session);
  }
  signout() {}

  private scheduleRefresh() {
    this.cancelScheduledRefresh();

    if (!this.sessionExpiry) {
      return;
    }

    const now = Date.now();
    const expiryMs = this.sessionExpiry.getTime();
    const delay = expiryMs - now - REFRESH_BUFFER_MS;

    if (delay <= 0) {
      // Already past refresh window, refresh immediately
      this.refreshBearer().catch((err) => {
        console.warn("Immediate refresh failed:", err);
      });
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshBearer().catch((err) => {
        console.warn("Scheduled refresh failed:", err);
      });
    }, delay);
  }

  private cancelScheduledRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}
