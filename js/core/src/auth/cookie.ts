import { TypeOf } from "suretype";
import { passwordAuthSchema } from "../http/types";
import { AuthAdapter } from "./adapters";
import { passwordAuthCookie } from "../http/auth";

export class CookieAuth implements AuthAdapter {
  credentials: RequestCredentials = "include";
  constructor() {}
  headers(json: boolean = true) {
    const headers: Record<string, string> = {};
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
  }
  initOpts(init: RequestInit) {
    init.credentials = "include";
  }
  authWithPassword(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    const res = await passwordAuthCookie(this, opts);
    this.setSession({
      id: res.data.id,
      expires: new Date(res.data.expires),
      refreshExpires: new Date(res.data.refreshExpires),
      userId: res.data.userId,
    });
  }
  // TODO: Confirm success
  // or logout, or retry/back-off
  async refresh() {
    const res = await refreshCookie(this);
  }
}
