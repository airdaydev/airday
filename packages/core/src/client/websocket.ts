import type { AirdayClient } from "./main";

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
    this.send({
      type: "bearer_auth",
      token: this.client.session.token,
    });
  }
  send(data: any) {
    return this.ws.send(JSON.stringify(data));
  }
  // Explicit reconnect is useful for doing cookie authorisation
  reconnect() {}
  listener = (messageEvent: MessageEvent) => {
    console.log(messageEvent);
  };
}
