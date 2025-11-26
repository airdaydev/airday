import { TypeOf } from "suretype";
import { Uuidv4 } from "../common/uuid";
import { AirdayCore } from "../core";
import { passwordAuthBearer, refreshBearer } from "../http/auth";
import { passwordAuthSchema } from "../http/types";
import { AuthAdapter } from "./adapters";

interface BearerSessionData {
  userId: Uuidv4;
  primaryLibraryId: Uuidv4;
  sessionExp: Date;
  refreshExp: Date;
}

export class BearerAuth implements AuthAdapter {
  core: AirdayCore;
  sessionToken: string = "zzz";
  credentials: RequestCredentials = "omit";
  sessionData?: BearerSessionData;
  constructor(core: AirdayCore) {
    this.core = core;
  }
  headers(json: boolean = true) {
    if (!this.sessionToken) throw new Error("User is not authenticated");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.sessionToken}`,
    };
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
  }
  initOpts(init: RequestInit) {
    if (!init.headers) {
      init.headers = {};
    }
  }
  authWithPassword(opts: TypeOf<typeof passwordAuthSchema.schema>) {
    const res = await passwordAuthBearer(this.core, opts);
    this.sessionData = {
      sessionToken: res.data.sessionToken,
      refreshToken: res.data.refreshToken,
    };
    return res;
  }
  async refreshBearer() {
    const res = await refreshBearer(this.core);
    return res;
  }
}
