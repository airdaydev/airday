// Browser-specific construction of the shared `SyncBridge`. The
// pump + reconnect + auth-probe lifecycle lives in `@airday/core`;
// this module only contributes the two things that depend on the
// browser environment: the `WebSocket` factory (cookie auth via
// same-origin, URL derived from `window.location`) and the auth
// probe (the `/api/devices` endpoint via our msgpack HTTP client).

import {
  SyncBridge,
  type SyncBridgeOpts,
} from "@airday/core/sync-bridge";
import { api, ApiError } from "./api.ts";

type WebOpts = Omit<SyncBridgeOpts, "socketFactory" | "probeAuth">;

export function createSyncBridge(opts: WebOpts): SyncBridge {
  return new SyncBridge({
    ...opts,
    socketFactory: () => new WebSocket(wsUrl()),
    probeAuth: async () => {
      try {
        await api.listDevices();
        return true;
      } catch (e) {
        // 401 from a known-authed endpoint = server says our cookie is
        // bad (revoked device, password reset elsewhere). Anything
        // else (network drop, 5xx) → reconnect.
        if (e instanceof ApiError && e.status === 401) return false;
        return true;
      }
    },
  });
}

export { SyncBridge };

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/sync`;
}
