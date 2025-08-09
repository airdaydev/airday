import { Uuidv4 } from "../common/uuid";
import { AirdayCore } from "../core";
import { Uuid } from "../proto/uuid";
import { AirdayBatchMessage, ItemSyncReqAction } from "./actions";

export const streamKey = (libraryId: Uuidv4, resource: "item" | "list") => {
  return `${libraryId.toHex()}:${resource}`;
};

// Subprotocols for AirdayCore streams
// Activated on connect/reconnect
export class SyncStream {
  core: AirdayCore;
  id = new Uuidv4();
  libraryId: Uuidv4;
  syncing = false;
  constructor(core: AirdayCore, libraryId: Uuidv4) {
    this.core = core;
    this.libraryId = libraryId;
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
    // TODO: Boot this to SyncStream
    const action = new ItemSyncReqAction(this.libraryId, serverTimestamp);
    const message = new AirdayBatchMessage([action]);
    this.core.ws.enqueueAirdayMessage(message);
  }
}

export class ListSyncStream extends SyncStream {}
