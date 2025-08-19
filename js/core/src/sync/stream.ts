import { Uuidv4 } from "../common/uuid";
import { AirdayCore } from "../core";
import { ResourceType } from "../proto";
import { SyncStreamReqMessage } from "./actions";

// Subprotocols for AirdayCore streams
// Activated on connect/reconnect
export class SyncStream {
  core: AirdayCore;
  id = new Uuidv4();
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
  start(serverSeq: bigint | null) {
    this.syncing = true;
    const message = new SyncStreamReqMessage(
      this.resource,
      this.libraryId,
      serverSeq,
    );
    this.core.ws.enqueueAirdayMessage(message);
  }
  // listen: on data
  // listen: on end
  // listen: on error (?!)
}

export class ItemSyncStream extends SyncStream {
  getSince(serverSeq: bigint | null) {
    const message = new SyncStreamReqMessage(
      ResourceType.Item,
      this.libraryId,
      serverSeq,
    );
    this.core.ws.enqueueAirdayMessage(message);
  }
}

export class ListSyncStream extends SyncStream {
  getSince(serverSeq: bigint | null) {
    const message = new SyncStreamReqMessage(
      ResourceType.List,
      this.libraryId,
      serverSeq,
    );
    this.core.ws.enqueueAirdayMessage(message);
  }
}
