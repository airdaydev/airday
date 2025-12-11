import { TypeOf } from "suretype";
import { passwordAuthSchema } from "../http/types";
import { SessionLike } from "./types";

export abstract class AuthAdapter {
  readonly apiUrl: URL;
  constructor(apiUrl: URL) {
    this.apiUrl = apiUrl;
  }
  abstract attemptBoot(sessionLike: SessionLike): {};
  abstract requestHeaders(json?: boolean): Record<string, string>;
  abstract passwordAuth(
    opts: TypeOf<typeof passwordAuthSchema.schema>,
  ): Promise<void>;
  abstract signout(): void;
  private scheduleRefresh() {
    this.cancelScheduledRefresh();

    if (!this.sessionExpiry) {
      return;
    }

    const now = Date.now();
    const expiryMs = this.sessionExpiry.getTime();
    const delay = expiryMs - now - REFRESH_BUFFER_MS;

    if (delay <= 0) {
      // Already past refresh window, refresh immediately
      this.refreshBearer().catch((err) => {
        console.warn("Immediate refresh failed:", err);
      });
      return;
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshBearer().catch((err) => {
        console.warn("Scheduled refresh failed:", err);
      });
    }, delay);
  }

  private cancelScheduledRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}
