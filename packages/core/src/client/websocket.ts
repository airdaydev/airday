import { Builder, ByteBuffer } from "flatbuffers";
import {
  AirdayActionProto,
  AirdayMessageProto,
  AuthenticateActionProto,
  AuthenticateResponseProto,
  MessageProto,
  MessageWrapperProto,
} from "../proto";
import type { AirdayClient } from "./main";
import { AuthenticateAction, createAirdayMessage } from "../tasks/actions";

// TODO: Offline considerations
export class WebsocketManager {
  client: AirdayClient;
  ws: WebSocket;
  authorised = false;
  constructor(client: AirdayClient) {
    this.client = client;
    const address = client.root;
    address.pathname = "ws";
    console.debug(`WS connection attempt to ${address}`);
    this.ws = new WebSocket(address);
    this.ws.addEventListener("message", this.listener);
    this.ws.addEventListener("error", (error) => {
      console.error("error");
    });
    this.ws.addEventListener("close", (event) => {
      console.error("closed");
    });
  }
  bearerAuth() {
    if (!this.client.session?.token) {
      console.warn("Cannot websocket bearer auth, no bearer token");
      return;
    }
    const action = new AuthenticateAction(this.client.session.token);
    const msg = createAirdayMessage([action]);
    console.log("sending", msg);
    this.ws.send(msg);
  }
  send(data: any) {
    // if (!this.authorised) {
    //   throw new Error("Attempted to use ws connection while not authorised");
    // }
    return this.ws.send(data);
  }
  close() {
    return this.ws.close();
  }
  // Explicit reconnect is useful for doing cookie authorisation
  reconnect() {}
  listener = (messageEvent: MessageEvent) => {
    if (messageEvent.type === "message") {
      // TODO: parse binary messages here, then provide response subscription system
      console.log("message received", messageEvent);
      const bb = new ByteBuffer(messageEvent.data);
      const msg = MessageWrapperProto.getRootAsMessageWrapperProto(bb);
      if (msg.messageType() === MessageProto.AirdayMessageProto) {
        const airdayMessage = new AirdayMessageProto();
        msg.message(airdayMessage);
        this.handleAirdayMessage(airdayMessage);
      }
    }
  };
  // TODO Consider moving this into subhandler
  private handleAirdayMessage(message: AirdayMessageProto) {
    if (!message) return;

    const batchLength = message.batchLength();
    for (let i = 0; i < batchLength; i++) {
      const component = message.batch(i);
      if (!component) continue;

      const actionType = component.actionType();

      switch (actionType) {
        case AirdayActionProto.AuthenticateResponseProto:
          const authResponse = new AuthenticateResponseProto();
          component.action(authResponse);
          this.authorised = authResponse.success() === true;
          break;
        case AirdayActionProto.AddItemActionProto:
          // const addItemAction = component.action(new AddItemActionProto());
          // this.handleAddItemAction(addItemAction);
          break;
        case AirdayActionProto.DeleteItemActionProto:
          // const deleteItemAction = component.action(
          //   new DeleteItemActionProto(),
          // );
          // this.handleDeleteItemAction(deleteItemAction);
          break;
        default:
          console.warn("Unknown action type:", actionType);
      }
    }
  }
}
