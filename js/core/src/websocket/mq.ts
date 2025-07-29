import type { AirdayCore } from "../core";
import { MessageProto } from "../proto";

type ObserverFunc = (action: MessageProto) => void;

export enum Protocol {
  Airday = 0,
  JMAP = 1,
}

export interface MQMessage {
  toFlatBuffer(): Uint8Array;
}

export interface QueuedMessage {
  type: Protocol;
  message: MQMessage;
}

export interface AirdayQueuedMessage extends QueuedMessage {
  type: Protocol.Airday;
}

// TODO: Add time based message flushing
// TODO: use this.core.ws.ws.bufferedAmount + consider merging this with websocket manager
export class MessageQueue {
  core: AirdayCore;
  queue: Array<QueuedMessage> = [];
  pendingMessages = new Map<string, QueuedMessage>();
  running = false;
  maxBatch = 50;
  maxPendingMessages = 5;
  observers = new Set<ObserverFunc>();
  constructor(core: AirdayCore) {
    this.core = core;
  }
  subscribe(observerFn: ObserverFunc) {
    this.observers.add(observerFn);
    return () => this.observers.delete(observerFn);
  }
  enqueue(message: QueuedMessage) {
    this.queue.push(message);
    this.next();
  }
  enqueueAirdayMessage(message: MQMessage) {
    const queuedMessage: QueuedMessage = {
      type: Protocol.Airday,
      message,
    };
    this.enqueue(queuedMessage);
  }
  next() {
    // 1. Test if queue is live
    const messageQueueFull =
      this.pendingMessages.size > this.maxPendingMessages;
    if (
      !this.running ||
      messageQueueFull ||
      !this.core.ws.authorised ||
      this.queue.length === 0
    ) {
      // TODO: We need a means for the sync batcher to continue when auth starts
      return; // Wait until pending messages are done
    }
    // 2. Form batch
    const batch: QueuedMessage[] = [];
    while (this.queue.length > 0 && batch.length < this.maxBatch) {
      const item = this.queue[0];
      this.queue.shift();
      if (item.type === Protocol.Airday) {
        batch.push(item);
      } else {
        // discard for now
      }
    }
    this.wsSend(batch);
    if (!messageQueueFull && this.queue.length > 0) {
      this.next();
    }
  }
  async wsSend(batch: Array<QueuedMessage>) {
    batch.map((item) => {
      this.core.ws.send(item.message.toFlatBuffer());
    });
  }
  stop() {
    this.running = false;
  }
  start() {
    this.running = true;
    this.next();
  }
  drain() {
    // TODO: implement if needed
  }
  // onBatchCompletion(actions: MessageWrapperProto[]) {
  //   actions.map((action) => {
  //     this.observers.forEach((fn) => {
  //       fn(action);
  //     });
  //   });
  // }
}
