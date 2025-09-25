import { Uuidv4 } from "../common/uuid";
import { AirdayCore } from "../core";
import { SyncStreamReqMessage } from "./fb";

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
  get key() {
    return `${this.libraryId.toHex()}`;
  }
  start(serverSeq: bigint | null) {
    this.syncing = true;
    const message = new SyncStreamReqMessage(this.libraryId, serverSeq);
    this.core.ws.enqueueAirdayMessage(message);
  }
  // listen: on data
  // listen: on end
  // listen: on error (?!)
  getSince(serverSeq: bigint | null) {
    const message = new SyncStreamReqMessage(this.libraryId, serverSeq);
    this.core.ws.enqueueAirdayMessage(message);
  }
}
