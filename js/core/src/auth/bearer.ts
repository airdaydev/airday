import { TypeOf } from "suretype";
import { Uuidv4 } from "../common/uuid";
import { passwordAuthBearer, refreshBearer } from "../http/auth";
import { passwordAuthSchema } from "../http/types";
import { AuthAdapter, AuthState } from "./adapter";
import { verifyToken } from "./token";

// Stored & retrieved in local_storage
interface BearerLocalStorageData {
  sessionToken: string;
  refreshToken: string;
}

const SESSION_STORAGE_KEY = "airday_session";

interface UserData {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
}

export class BearerAuth implements AuthAdapter {
  readonly apiUrl: URL;
  readonly publicKey: string;
  sessionToken?: string;
  refreshToken?: string;
  sessionExpiry?: number;
  credentials: RequestCredentials = "omit";
  state: AuthState = AuthState.Uninitialised;
  userData?: UserData;
  constructor(apiUrl: URL, publicKey: string) {
    this.apiUrl = apiUrl;
    this.publicKey = publicKey;
  }
  async setTokens(sessionToken: string, refreshToken: string) {
    this.sessionToken = sessionToken;
    this.refreshToken = refreshToken;
    const payload = await verifyToken(this.publicKey, sessionToken);
    // TODO: Save sessionExpiry
    // this.sessionExpiry = payload.exp;
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ sessionToken, refreshToken }),
    );
    this.state = AuthState.Loaded;
  }
  async loadAuthState(): Promise<boolean> {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      this.state = AuthState.Anon;
      return false;
    }
    try {
      const { sessionToken, refreshToken } = JSON.parse(
        stored,
      ) as BearerLocalStorageData;
      await this.setTokens(sessionToken, refreshToken);
      this.state = AuthState.Loaded;
      return true;
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      this.state = AuthState.Anon;
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
  async authWithPassword(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    const res = await passwordAuthBearer(this.apiUrl, opts);
    return res;
  }
  async refreshBearer() {
    if (!this.refreshToken) {
      // TODO: Drop the error
      throw new Error("can't refresh without token");
    }
    const res = await refreshBearer(this.apiUrl, this.refreshToken);
    return res;
  }
  signout() {}
}
