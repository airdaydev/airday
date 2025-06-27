import type { AirdayClient } from "./main";

export class Websocket {
  client: AirdayClient;
  ws: WebSocket;
  authorised = false;
  constructor(client: AirdayClient) {
    this.client = client;
    this.ws = new WebSocket(`${client.root}/ws`);
    this.ws.addEventListener("message", this.listener);
  }
  bearerAuth() {
    if (!this.client.session?.token) {
      console.warn("Cannot websocket bearer auth, no bearer token");
      return;
    }
    this.send({
      type: "bearer-auth",
      token: this.client.session.token,
    });
  }
  send(data: any) {
    return this.ws.send(JSON.stringify(data));
  }
  listener = (messageEvent: MessageEvent) => {
    console.log(messageEvent);
  };
}
