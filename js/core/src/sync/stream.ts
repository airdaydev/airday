import { EventEmitter } from "../common/events";
import { Uuidv4 } from "../common/uuid";
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
  id = new Uuidv4();
  startSeq = 0n;
  libraryId: Uuidv4;
  syncing = false;
  events = new EventEmitter<StreamEventMap>();
  finished = false;
  constructor(libraryId: Uuidv4, startSeq = 0n) {
    this.libraryId = libraryId;
    this.startSeq = startSeq;
  }
  processMessage(streamContext: StreamContext) {
    switch (streamContext.event) {
      case StreamEventProto.Data: {
        this.events.emit("data", {});
      }
      case StreamEventProto.Error: {
        console.error("Stream ended with an error!", streamContext.id);
        this.end();
      }
      case StreamEventProto.End: {
        this.end();
      }
    }
  }
  get key() {
    return `${this.libraryId.toHex()}`;
  }
  req() {
    this.syncing = true;
    const req = new SyncStreamReqMessage(
      this.id,
      this.libraryId,
      this.startSeq,
    );
    return req;
  }
  async end() {
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
