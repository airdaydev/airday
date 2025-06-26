import type { AirdayItem } from "../types/item";
import type { AirdayClient } from "./client";
import { LWW, type SerialisedLWWRegister } from "./lww";

export enum ActionType {
  addItem = "addItem",
  updateItem = "updateItem",
  deleteItem = "deleteItem",
}

interface BaseAction {
  state: "pending" | "completed" | "failed";
  type: ActionType;
  payload: any;
}

interface SerialisedAirdayItem {
  id: string;
  text: SerialisedLWWRegister<string>;
}

interface AddItemAction extends BaseAction {
  type: ActionType.addItem;
  payload: SerialisedAirdayItem;
}

export const addItem = (item: AirdayItem): AddItemAction => ({
  state: "pending",
  type: ActionType.addItem,
  payload: item.toJSON(),
});

type Action = AddItemAction;

interface Message {
  traceId: string;
  actions: Action[];
}

type ObserverFunc = (action: Action) => void;

export class ItemClient {
  airdayClient: AirdayClient;
  lww = new LWW(); // TODO: Retain PID if exists
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
