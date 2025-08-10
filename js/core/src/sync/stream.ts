import { Uuidv4 } from "../common/uuid";
import { AirdayCore } from "../core";
import { ResourceType } from "../proto";
import { AirdayBatchMessage, SyncReqAction } from "./actions";

// Subprotocols for AirdayCore streams
// Activated on connect/reconnect
export class SyncStream {
  core: AirdayCore;
  id = new Uuidv4(); // TODO: Is this necessary?
  libraryId: Uuidv4;
  syncing = false;
  resource: ResourceType = ResourceType.Item;
  constructor(core: AirdayCore, libraryId: Uuidv4) {
    this.core = core;
    this.libraryId = libraryId;
  }
  get key() {
    return `${this.libraryId.toHex()}:${this.resource}`;
  }
  start() {
    this.syncing = true;
  }
  end() {}
  // on end
  // on error (?!)
}

export class ItemSyncStream extends SyncStream {
  getSince(serverTimestamp: number | null) {
    const action = new SyncReqAction(
      ResourceType.Item,
      this.libraryId,
      serverTimestamp,
    );
    const message = new AirdayBatchMessage([action]);
    this.core.ws.enqueueAirdayMessage(message);
  }
}

export class ListSyncStream extends SyncStream {
  getSince(serverTimestamp: number | null) {
    const action = new SyncReqAction(
      ResourceType.List,
      this.libraryId,
      serverTimestamp,
    );
    const message = new AirdayBatchMessage([action]);
    this.core.ws.enqueueAirdayMessage(message);
  }
}
