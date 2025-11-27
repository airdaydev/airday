import { WebsocketManager } from "./websocket";
import { AirdaySync } from "./sync";
import { AirdayStorage } from "./storage";
import { StorageAdapter } from "./storage/adapter";
import { AuthAdapter } from "./auth/adapters";

interface AirdayCoreOpts {
  apiUrl: URL;
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
  apiUrl: URL;
  session?: Session;
  ws: WebsocketManager; // websocket layer
  sync: AirdaySync; // airday item layer
  storage: AirdayStorage; // mem & idb storage layer
  auth: AuthAdapter;
  // TODO: Refresh token management
  constructor(opts: AirdayCoreOpts) {
    this.apiUrl = opts.apiUrl;
    this.ws = new WebsocketManager(this);
    this.sync = new AirdaySync(this);
    this.storage = new AirdayStorage(this, opts.storageAdapter);
    if (!opts.authAdapter) {
      throw new Error("AuthAdapter required in AirdayCore constructor");
    }
    this.auth = opts.authAdapter;
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
