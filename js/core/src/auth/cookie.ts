import { v } from "suretype";

export const storedCookieSession = v.object({
  type: v.string().const("cookie").required(),
  sessionToken: v.string().required(),
  refreshToken: v.string().required(),
});

export class CookieV2 extends AuthAdapterV2 {
  requestCredentials: RequestCredentials = "include";
  requestHeaders(json: boolean = true): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) {
      headers["Accept-Content"] = "application/json";
    }
    return headers;
  }
}
