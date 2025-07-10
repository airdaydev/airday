import { Builder } from "flatbuffers";
import { AuthenticateActionProto } from "../proto";
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
    // TODO: We must wait for response!
    console.log(messageEvent);
  };
}
