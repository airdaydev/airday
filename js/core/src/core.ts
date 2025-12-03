import { WebsocketManager } from "./websocket";
import { AirdaySync, parseFrames } from "./sync";
import { AirdayStorage } from "./storage";
import { StorageAdapter } from "./storage/adapter";
import { AuthAdapter, AuthState, newLocalSession } from "./auth/adapter";
import { BearerAuth, getInitialSession } from "./auth/bearer";

interface AirdayCoreOpts {
  apiUrl: URL;
  authAdapter: AuthAdapter;
  storageAdapter?: StorageAdapter;
}

const enum SyncState {
  Stopped,
  Started,
  Stopping,
}

export class AirdayCore {
  readonly apiUrl: URL;
  syncState = SyncState.Stopped;
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
    this.auth.events.on("authenticated", async (sessionData) => {
      // TODO: Reset first
      // this.stopSync();
      await this.storage.initDb(sessionData.userId);
      this.startSync();
    });
    this.init().catch((err) => {
      console.warn(err);
      this.reset();
    });
  }
  async init() {
    const session = getInitialSession();
    const sessionData = await (this.auth as BearerAuth).bootSession(session); // TODO: ...
  }
  async reset() {
    const session = newLocalSession();
    const sessionData = await (this.auth as BearerAuth).bootSession(session); // TODO: ...
    await this.storage.initDb(sessionData.userId);
  }
  async startSync() {
    if (this.auth.state !== AuthState.Remote) {
      console.warn("attempted to startSync without credentials loaded");
      return;
    }
    // TODO: This should be embedded in sync state / ws state
    if (this.syncState !== SyncState.Stopped) {
      throw new Error("Sync already started");
    }
    this.syncState = SyncState.Started;
    try {
      const protoFrames = this.ws.frames();
      const parsedFrames = parseFrames(protoFrames);
      for await (const frame of parsedFrames) {
        console.debug("incoming frame", frame);
        await this.sync.handleFrame(frame);
      }
    } catch (err) {
      console.error("startSync failed", err);
    }
    this.syncState = SyncState.Stopped;
  }
  // Stop but keep ingesting queued frames
  stopSync() {
    // TODO: Provide a wait api
    this.syncState = SyncState.Stopping;
    this.ws.stop();
  }
}
