import { TypeOf } from "suretype";
import { passwordAuthSchema } from "../http/types";
import { AuthAdapter } from "./adapters";
import { passwordAuthCookie, refreshCookie } from "../http/auth";
import { AirdayCore } from "../core";
import { Uuidv4 } from "../common/uuid";

interface CookieSessionData {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
  sessionExp: Date;
  refreshExp: Date;
}

export class CookieAuth implements AuthAdapter {
  core: AirdayCore;
  credentials: RequestCredentials = "include";
  sessionData?: CookieSessionData;
  constructor(core: AirdayCore) {
    this.core = core;
  }
  headers(json: boolean = true) {
    const headers: Record<string, string> = {};
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
  }
  initOpts(init: RequestInit) {
    init.credentials = "include";
  }
  async authWithPassword(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    const res = await passwordAuthCookie(this.core, opts);
    // this.sessionData = {
    //   id: res.data.id,
    //   expires: new Date(res.data.expires),
    //   refreshExpires: new Date(res.data.refreshExpires),
    //   userId: res.data.userId,
    // };
  }
  signout() {}
  async refresh() {
    const res = await refreshCookie(this.core);
  }
}
