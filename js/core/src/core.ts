import { WebsocketManager } from "./websocket";
import { AirdaySync } from "./sync";
import { AirdayStorage } from "./storage";
import { StorageAdapter } from "./storage/adapter";
import { AuthAdapter } from "./session/adapter";
import { AirdaySession } from "./session";
import { SessionType } from "./session/types";

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
    this.session.events.on("initialised", async (sessionData) => {
      console.log("initialised");
      // TODO: If sync is in an intermediate state, do not allow this to occur
      await this.ws.stop(); // TODO: Consider making this controlled by sync
      await this.storage.initDb(
        sessionData,
        this.session.type === SessionType.Remote,
      );
      if (this.session.type === SessionType.Remote) {
        this.sync.start();
      }
    });
  }
}
