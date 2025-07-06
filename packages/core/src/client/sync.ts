import type { AirdayClient } from "./main";
import { LWW } from "../crdt/lww";
import type { Message } from "../air-fb";
import { ByteBuffer, type Builder } from "flatbuffers";
import { MessageWrapper } from "../air-fb/message-wrapper";

type ObserverFunc = (action: Message) => void;

export enum Protocol {
  Airday = 0,
  JMAP = 1,
}

export type ActionBatch<T> = {
  type: Protocol;
  action: T[];
};

export class SyncClient {
  airdayClient: AirdayClient;
  lww = new LWW(); // TODO: Retain PID if exists
  queue: Array<ActionBatch<any>> = [];
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
  wrapMessage(builder: Builder, type: Message, messageOffset: number) {
    // TODO: Add span/trace/ctx
    MessageWrapper.startMessageWrapper(builder);
    MessageWrapper.addMessageType(builder, type);
    MessageWrapper.addMessage(builder, messageOffset);
    return builder;
  }
  enqueue(actions: ActionBatch<any>[]) {
    if (Array.isArray(actions)) {
      this.queue.push(...actions);
    }
    this.next();
  }
  enqueueAirdayAction(fb: Uint8Array) {
    const action: ActionBatch<Uint8Array> = {
      type: Protocol.Airday,
      action: [fb],
    };
    this.enqueue([action]);
  }
  next() {
    const messageQueueFull =
      this.pendingMessages.size > this.maxPendingMessages;
    if (!this.running || messageQueueFull || this.queue.length === 0) {
      return; // Wait until pending messages are done
    }
    // TODO: Possible optimisation; count batch count towards pending messages count!
    while (this.queue.length > 0) {
      const item = this.queue[0];
      this.queue.shift();
      if (item.type === Protocol.Airday) {
        // this.wsSend(item);
      } else {
        // discard for now
      }
    }
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
