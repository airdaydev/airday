import type { AirdayClient } from "./main";
import { LWW } from "../crdt/lww";

type ActionState = "pending" | "completed" | "failed";

export interface Action {
  state: ActionState;
  type: string;
  payload: any;
}

interface Message {
  traceId: string;
  actions: Action[];
}

type QueueItem = Action | Action[];

type ObserverFunc = (action: Action) => void;

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
  async enqueueActions(actions: Action[]) {
    this.queue.push(...actions);
    this.next();
  }
  enqueueAtomicBatch(batch: Action[]) {
    this.queue.push(batch);
  }
  next() {
    const messageQueueFull =
      this.pendingMessages.size > this.maxPendingMessages;
    if (!this.running || messageQueueFull || this.queue.length === 0) {
      return; // Wait until pending messages are done
    }
    const batch: Action[] = [];

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
  async wsSend(actions: Array<Action>) {
    // TODO: encode and wsSend
    // TODO: Validate returned action
    // TODO: We need a timeout and ask to put back on the queue
    const message: Message = {
      traceId: "1234",
      actions,
    };
    Promise.resolve(message).then((message) => {
      this.pendingMessages.delete(message.traceId);
      this.onBatchCompletion(message.actions);
      this.next();
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
  // TODO: Backoff
  onBatchCompletion(actions: Action[]) {
    actions.map((action) => {
      this.observers.forEach((fn) => {
        fn(action);
      });
    });
  }
}
