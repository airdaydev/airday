import { WebsocketManager } from "./websocket";
import { AirdaySync } from "./sync";
import { AirdayStorage } from "./storage";
import { StorageAdapter } from "./storage/adapter";
import { AuthAdapter } from "./auth/adapter";
import { AirdaySession } from "./auth/auth";

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
  session: AirdaySession;
  constructor(opts: AirdayCoreOpts) {
    this.apiUrl = opts.apiUrl;
    this.ws = new WebsocketManager(this);
    this.sync = new AirdaySync(this);
    this.storage = new AirdayStorage(this, opts.storageAdapter);
    this.session = new AirdaySession(opts.authAdapter);
    if (!opts.authAdapter) {
      throw new Error("AuthAdapter required in AirdayCore constructor");
    }
    // this.auth.events.on("initialised", async (sessionData) => {
    //   await this.ws.stop();
    //   await this.storage.initDb(sessionData.userId);
    //   if (this.auth.state === AuthState.Remote) {
    //     this.sync.start();
    //   }
    // });
  }
  async init() {
    this.session.loadFromStorage();
  }
  // async reset() {
  //   this.session.anon();
  // }
}
