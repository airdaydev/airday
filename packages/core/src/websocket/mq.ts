import type { AirdayCore } from "../core";
import { MessageProto } from "../proto";

type ObserverFunc = (action: MessageProto) => void;

export enum Protocol {
  Airday = 0,
  JMAP = 1,
}

export interface QueuedMessage {
  type: Protocol;
  message: Uint8Array;
}

export interface AirdayQueuedMessage extends QueuedMessage {
  type: Protocol.Airday;
}

// TODO: Add time based message flushing
export class MessageQueue {
  core: AirdayCore;
  queue: Array<QueuedMessage> = [];
  pendingMessages = new Map<string, QueuedMessage>();
  running = true;
  maxBatch = 50;
  maxPendingMessages = 5;
  timeout = 10000;
  retries = 3;
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
  enqueueAirdayMessage(fb: Uint8Array) {
    const message: QueuedMessage = {
      type: Protocol.Airday,
      message: fb,
    };
    this.enqueue(message);
  }
  next() {
    const batch: QueuedMessage[] = [];
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
    // TODO: Possible optimisation; count batch count towards pending messages count! (separate from pendingMessages.size)
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
      this.core.ws.send(item.message);
    });
    // TODO: We need a timeout and ask to put back on the queue
    // Promise.resolve(batchInput).then((batch) => {
    //   this.pendingMessages.delete(batch.id);
    //   this.onBatchCompletion(batch.actions);
    //   this.next();
    // });
    // batchInput.forEach((messageWrapper) => {
    //   this.core.ws.send(messageWrapper.fb);
    //   this.pendingMessages.delete(key)
    // });
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
  // TODO: Backoff
  // onBatchCompletion(actions: MessageWrapperProto[]) {
  //   actions.map((action) => {
  //     this.observers.forEach((fn) => {
  //       fn(action);
  //     });
  //   });
  // }
}
