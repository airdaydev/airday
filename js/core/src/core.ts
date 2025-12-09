import { WebsocketManager } from "./websocket";
import { AirdaySync } from "./sync";
import { AirdayStorage } from "./storage";
import { StorageAdapter } from "./storage/adapter";
import { AuthAdapter, AuthState, newLocalSession } from "./auth/adapter";
import { BearerAuth, getInitialSession } from "./auth/bearer";

interface AirdayCoreOpts {
  apiUrl: URL;
  authAdapter: AuthAdapter;
  storageAdapter?: StorageAdapter;
}

export class AirdayCore {
  readonly apiUrl: URL;
  ws: WebsocketManager;
  sync: AirdaySync;
  storage: AirdayStorage;
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
    this.auth.events.on("initialised", async (sessionData) => {
      await this.ws.stop();
      await this.storage.initDb(sessionData.userId);
      if (this.auth.state === AuthState.Remote) {
        this.sync.start();
      }
    });
  }
  async init() {
    const session = getInitialSession();
    const sessionData = await (this.auth as BearerAuth).bootSession(session);
    // TODO: ...
  }
  async reset() {
    // TODO: Wipe session
    const session = newLocalSession();
    const sessionData = await (this.auth as BearerAuth).bootSession(session);
    // TODO: ...
    await this.storage.initDb(sessionData.userId);
  }
}
