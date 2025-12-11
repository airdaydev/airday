import { v } from "suretype";
import { AuthAdapter } from "./adapter";

export const storedCookieSession = v.object({
  type: v.string().const("cookie").required(),
  sessionToken: v.string().required(),
  refreshToken: v.string().required(),
});

export class CookieAdapter extends AuthAdapter {
  requestCredentials: RequestCredentials = "include";
  requestHeaders(json: boolean = true): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
    return headers;
  }
}
