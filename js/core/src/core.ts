import {
  passwordAuthBearer,
  passwordAuthCookie,
  passwordAuthSchema,
  refreshBearer,
  refreshCookie,
} from "./http/auth";
import { WebsocketManager } from "./websocket";
import { AirdaySync } from "./sync";
import type { TypeOf } from "suretype";
import { AirdayStorage } from "./storage";
import { StorageAdapter } from "./storage/adapter";
import { Library } from "./common/library";

export enum AuthMode {
  ImplicitCookie,
  BearerToken,
}

interface AirdayCoreOpts {
  rootUrl: string;
  authMode?: AuthMode;
  storageAdapter?: StorageAdapter;
}

interface Session {
  id: string;
  token?: string;
  expires: Date;
  refreshToken?: string;
  refreshExpires: Date;
  userId: string;
}

// TODO: Consider making a separate HTTP (and/or auth) class
export class AirdayCore {
  root: URL;
  authMode: AuthMode;
  session?: Session;
  ws: WebsocketManager; // websocket layer
  sync: AirdaySync; // airday item layer
  storage: AirdayStorage; // mem & idb storage layer
  // TODO: Refresh token management
  constructor(opts: AirdayCoreOpts) {
    this.root = new URL(opts.rootUrl);
    this.authMode = opts.authMode ?? AuthMode.ImplicitCookie;
    this.ws = new WebsocketManager(this);
    this.sync = new AirdaySync(this);
    this.storage = new AirdayStorage(this, opts.storageAdapter);
  }
  endpoint(pathName: string) {
    const url = new URL(this.root);
    url.pathname = pathName;
    return url;
  }
  // TODO: differentiate between cookie & bearer
  setSession(session: Session) {
    this.session = session;
  }
  headers(json: boolean = true) {
    if (!this.session) throw new Error("User is not authenticated");
    const headers: Record<string, string> = {};
    if (this.authMode === AuthMode.BearerToken) {
      headers["Authorization"] = `Bearer ${this.session.token}`;
    }
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
    return headers;
  }
  credentials(): RequestCredentials {
    if (this.authMode === AuthMode.BearerToken) {
      return "omit";
    }
    return "include";
  }
  getInitOpts(init: RequestInit) {
    if (this.authMode === AuthMode.BearerToken) {
      if (!init.headers) {
        init.headers = {};
      }
    }
    if (this.authMode == AuthMode.ImplicitCookie) {
      init.credentials = "include";
    }
  }
  async refresh() {
    if (this.authMode === AuthMode.BearerToken) {
      return this.refreshBearer();
    }
    return this.refreshCookie();
  }
  // TODO: Confirm success
  // or logout, or retry/back-off
  async refreshCookie() {
    const res = await refreshCookie(this);
    this.setSession({
      id: res.data.id,
      expires: new Date(res.data.expires),
      refreshExpires: new Date(res.data.refreshExpires),
      userId: res.data.userId,
    });
    return res;
  }
  async refreshBearer() {
    const res = await refreshBearer(this);
    this.setSession({
      id: res.data.id,
      token: res.data.token,
      expires: new Date(res.data.expires),
      refreshToken: res.data.refreshToken,
      refreshExpires: new Date(res.data.refreshExpires),
      userId: res.data.userId,
    });
    return res;
  }
  async loginWithPasswordCookie(
    opts: TypeOf<typeof passwordAuthSchema.schema>,
  ) {
    this.authMode = AuthMode.ImplicitCookie;
    const res = await passwordAuthCookie(this, opts);
    this.setSession({
      id: res.data.id,
      expires: new Date(res.data.expires),
      refreshExpires: new Date(res.data.refreshExpires),
      userId: res.data.userId,
    });
  }
  async loginWithPasswordBearer(
    opts: TypeOf<typeof passwordAuthSchema.schema>,
  ) {
    this.authMode = AuthMode.BearerToken;
    const res = await passwordAuthBearer(this, opts);
    this.setSession({
      id: res.data.id,
      token: res.data.token,
      expires: new Date(res.data.expires),
      refreshToken: res.data.refreshToken,
      refreshExpires: new Date(res.data.refreshExpires),
      userId: res.data.userId,
    });
    return res;
  }
  async startSync() {
    try {
      const frames = this.ws.frames();
      for await (const frame of frames) {
        console.log(frame);
      }
    } catch (err) {
      console.error("startSync failed", err);
    }
  }
  stopSync() {
    this.ws.stop();
  }
}
