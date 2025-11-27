import { WebsocketManager } from "./websocket";
import { AirdaySync } from "./sync";
import { AirdayStorage } from "./storage";
import { StorageAdapter } from "./storage/adapter";
import { AuthAdapter, AuthState } from "./auth/adapter";

interface AirdayCoreOpts {
  apiUrl: URL;
  authAdapter: AuthAdapter;
  storageAdapter?: StorageAdapter;
}

export class AirdayCore {
  readonly apiUrl: URL;
  online = false;
  ws: WebsocketManager; // websocket layer
  sync: AirdaySync; // airday item layer
  storage: AirdayStorage; // mem & idb storage layer
  auth: AuthAdapter;
  constructor(opts: AirdayCoreOpts) {
    this.apiUrl = opts.apiUrl;
    this.ws = new WebsocketManager(this);
    this.sync = new AirdaySync(this);
    this.storage = new AirdayStorage(this, opts.storageAdapter);
    if (!opts.authAdapter) {
      throw new Error("AuthAdapter required in AirdayCore constructor");
    }
    this.auth = opts.authAdapter;
    this.auth.events.on("authenticated", () => {
      // Load storage!
      this.startSync();
    });
    this.auth.events.on("deauthenticated", () => {
      // TODO: Does this always mean sign out here?
      // What happens when you get kicked?
      // Leave storage
      this.stopSync();
    });
    this.init().catch((err) => {
      console.warn(err);
      this.reset();
    });
  }
  async init() {
    await this.auth.loadAuthState();
  }
  async reset() {
    // TODO: Errors here are currently fatal
    this.auth.clearAuthState();
  }
  async startSync() {
    if (this.auth.state !== AuthState.Loaded) {
      console.warn("attempted to startSync without credentials loaded");
      return;
    }
    if (this.online) {
      console.warn("attempted to startSync while already online");
      return;
    }
    this.online = true;
    try {
      const frames = this.ws.frames();
      for await (const frame of frames) {
        console.log(frame);
      }
    } catch (err) {
      console.error("startSync failed", err);
    }
    this.online = false;
  }
  stopSync() {
    this.ws.stop();
  }
}
