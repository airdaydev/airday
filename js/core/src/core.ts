import { WebsocketManager } from "./websocket";
import { AirdaySync } from "./sync";
import { AirdayStorage } from "./storage";
import { StorageAdapter } from "./storage/adapter";
import { AuthAdapter } from "./auth/adapters";

export enum AuthMode {
  Cookie,
  BearerToken,
}

interface AirdayCoreOpts {
  rootUrl: string;
  paseto_pk: string;
  authAdapter: AuthAdapter;
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
  session?: Session;
  ws: WebsocketManager; // websocket layer
  sync: AirdaySync; // airday item layer
  storage: AirdayStorage; // mem & idb storage layer
  auth: AuthAdapter;
  // TODO: Refresh token management
  constructor(opts: AirdayCoreOpts) {
    this.root = new URL(opts.rootUrl);
    this.ws = new WebsocketManager(this);
    this.sync = new AirdaySync(this);
    this.storage = new AirdayStorage(this, opts.storageAdapter);
    if (!opts.authAdapter) {
      throw new Error("AuthAdapter required in AirdayCore constructor");
    }
    this.auth = opts.authAdapter;
  }
  endpoint(pathName: string) {
    const url = new URL(this.root);
    url.pathname = pathName;
    return url;
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
