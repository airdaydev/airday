import type { AirdayClient } from "./main";
import { LWW } from "../crdt/lww";
import type { Message } from "../air-fb";

export interface MessageWrapper {
  timestamp: number;
  traceId: string;
  fb: Uint8Array;
}

type QueueItem = MessageWrapper | MessageWrapper[];

type ObserverFunc = (action: Message) => void;

export class SyncClient {
  airdayClient: AirdayClient;
  lww = new LWW(); // TODO: Retain PID if exists
  queue: Array<QueueItem> = [];
  pendingMessages = new Map<string, Message>();
  running = true;
  maxBatch = 50;
  maxPendingMessages = 5;
  timeout = 10000;
  retries = 3;
  observers = new Set<ObserverFunc>();
  constructor(airdayClient: AirdayClient) {
    this.airdayClient = airdayClient;
  }
  subscribe(observerFn: ObserverFunc) {
    this.observers.add(observerFn);
    return () => this.observers.delete(observerFn);
  }
  async enqueueActions(actions: MessageWrapper[]) {
    this.queue.push(...actions);
    this.next();
  }
  enqueueAtomicBatch(batch: MessageWrapper[]) {
    this.queue.push(batch);
  }
  next() {
    const messageQueueFull =
      this.pendingMessages.size > this.maxPendingMessages;
    if (!this.running || messageQueueFull || this.queue.length === 0) {
      return; // Wait until pending messages are done
    }
    const batch: MessageWrapper[] = [];

    while (batch.length < this.maxBatch && this.queue.length > 0) {
      const item = this.queue[0];
      if (Array.isArray(item)) {
        // batched items that have to go together
        if (batch.length > 0 && batch.length + item.length > this.maxBatch) {
          // if the batch is a bigg'n, go next batch
          break;
        }
        batch.push(...item);
        this.queue.shift();
      } else {
        this.queue.shift();
        batch.push(item);
      }
    }
    this.wsSend(batch);
    if (!messageQueueFull && this.queue.length > 0) {
      this.next();
    }
  }
  async wsSend(batchInput: Array<MessageWrapper>) {
    // TODO: Validate returned action
    // TODO: We need a timeout and ask to put back on the queue
    // Promise.resolve(batchInput).then((batch) => {
    //   this.pendingMessages.delete(batch.id);
    //   this.onBatchCompletion(batch.actions);
    //   this.next();
    // });
    // batchInput.forEach((messageWrapper) => {
    //   this.airdayClient.ws.send(messageWrapper.fb);
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
  onBatchCompletion(actions: MessageWrapper[]) {
    actions.map((action) => {
      this.observers.forEach((fn) => {
        fn(action);
      });
    });
  }
}
