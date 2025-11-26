import { AuthAdapter } from "./adapters";

export class BearerAuth implements AuthAdapter {
  sessionToken: string = "zzz";
  credentials: RequestCredentials = "omit";
  constructor() {}
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
    const res = await passwordAuthBearer(this, opts);
    this.setSession({
      id: res.data.id,
      token: res.data.token,
      expires: new Date(res.data.expires),
      refreshToken: res.data.refreshToken,
      refreshExpires: new Date(res.data.refreshExpires),
      userId: res.data.userId,
    });
    return res;
  }
  async refreshBearer() {
    const res = await refreshBearer(this);
    return res;
  }
}
