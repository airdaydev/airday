import { EventEmitter } from "../common/events";
import { Uuidv4 } from "../common/uuid";
import { AirdayCore } from "../core";
import { StreamContextProto, StreamEventProto } from "../proto";
import { SyncStreamReqMessage } from "./fb";

export interface StreamContext {
  id: Uuidv4;
  event: StreamEventProto;
}

interface StreamEventMap {
  data: {};
  end: {}; // TODO: spit error here
}

// Subprotocols for AirdayCore streams
// Activated on connect/reconnect
export class SyncStream {
  core: AirdayCore;
  id = new Uuidv4();
  libraryId: Uuidv4;
  syncing = false;
  events = new EventEmitter<StreamEventMap>();
  finished = false;
  constructor(core: AirdayCore, libraryId: Uuidv4) {
    this.core = core;
    this.libraryId = libraryId;
  }
  processMessage(streamContext: StreamContext) {
    switch (streamContext.event) {
      case StreamEventProto.Data: {
        this.events.emit("data", {});
      }
      case StreamEventProto.Error: {
        console.error("Stream ended with an error!");
        this.events.emit("end", {});
        this.end();
      }
      case StreamEventProto.End: {
        this.events.emit("end", {});
        this.end();
      }
    }
  }
  get key() {
    return `${this.libraryId.toHex()}`;
  }
  start(serverSeq: bigint | null) {
    this.syncing = true;
    const message = new SyncStreamReqMessage(
      this.id,
      this.libraryId,
      serverSeq,
    );
    this.core.ws.enqueueAirdayMessage(message);
  }
  async end() {
    // Called from outside
    this.finished = true;
    this.events.emit("end", {});
  }
  done() {
    return new Promise((resolve) => {
      // TODO: This should also test ws outbound messages
      if (this.finished) resolve(null);
      this.events.once("end", resolve);
    });
  }
  // listen: on data
  // listen: on end
  // listen: on error (?!)
}

export function parseStreamCtx(
  streamContextProto: StreamContextProto | null,
): StreamContext | null {
  if (!streamContextProto) return null;
  let streamId = streamContextProto.id();
  if (streamId) {
    return {
      id: Uuidv4.fromFBProto(streamId),
      event: streamContextProto.event(),
    };
  }
  return null;
}
