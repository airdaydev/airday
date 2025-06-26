import type { AirdayClient } from "./client";

interface BaseAction {
  state: "pending" | "completed" | "failed";
  type: String;
  payload: any;
}

interface AddAction extends BaseAction {
  type: "add";
  payload: any;
}

interface UpdateAction extends BaseAction {
  type: "update";
  payload: any;
}

interface Sync extends BaseAction {
  type: "pull";
  payload: any;
}

type Action = AddAction | UpdateAction | Sync;

interface Message {
  traceId: string;
  actions: Action[];
}

type ObserverFunc = (action: Action) => void;

class ItemAPI {
  airdayClient: AirdayClient;
  queue: Action[] = [];
  pendingMessages = new Map<string, Message>();
  running = true;
  maxBatch = 10;
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
  // TODO: This assumes you are WALing this!
  enqueueBatch(actions: Action[]) {
    this.queue.concat(actions);
    this.next();
  }
  enqueue(action: Action) {
    this.queue.push(action);
  }
  next() {
    if (
      this.running === false ||
      this.pendingMessages.size > this.maxPendingMessages
    ) {
      return; // Wait until pending messages are done
    }
    const batch = this.queue.slice(0, this.maxPendingMessages);
    this.wsSend(batch);
  }
  async wsSend(actions: Action[]) {
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
