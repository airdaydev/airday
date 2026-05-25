// WebSocket pump + lifecycle around a sans-IO `SyncEngine`. Owned by
// the JS host (not the wasm core) so each platform — web, bun-based
// tests, future node CLI — can drive the same engine with the same
// reconnect / auth policy by injecting only the bits that differ:
//
//   - `socketFactory` builds a fresh `WebSocket` per attempt (cookie
//     auth on the browser, bearer header in Bun, etc.).
//   - `probeAuth` disambiguates a pre-open close: a returned `false`
//     means the server has confirmed our credentials are bad (HTTP
//     401), and the bridge stops permanently; anything else (success,
//     network error, non-auth HTTP error) reconnects.
//
// The engine itself stays sans-IO per `spec/architecture.md`; this
// file is what makes the IO testable from Bun instead of only from
// a browser.
//
// Reconnect is fixed-delay (no backoff). That's the same policy web
// has shipped with — revisit when we see hot-loop reconnect storms.

import type { EngineEvent, SyncEngine } from "../wasm/airday_core_web.js";

export type ConnectionEvent = "online" | "offline" | "drain";

export interface SyncBridgeOpts {
  engine: SyncEngine;
  /** Build a fresh socket. Called on every (re)connect, so callers
   *  can pick up rotated auth (cookie, header, ticket) without
   *  rebuilding the bridge. */
  socketFactory: () => WebSocket;
  /** Disambiguate a pre-open close: did the server reject auth, or
   *  was this a plain network drop? Resolve `false` only if the
   *  server confirms our credentials are bad (typically HTTP 401 on
   *  a known-authed endpoint). Any other outcome → resolve `true`
   *  and the bridge reconnects. Without a probe, every close
   *  reconnects — appropriate for tests where the only reason a
   *  pre-open close happens is that the server was killed. */
  probeAuth?: () => Promise<boolean>;
  /** Connection-state flips. `drain` fires after every outbox flush
   *  (server-triggered or host-triggered via `pumpOutbox`) — the
   *  natural pulse for "we just round-tripped with the server". */
  onChange?: (kind: ConnectionEvent) => void;
  /** Fires after every server frame the bridge feeds to the engine
   *  (post-pump). Hosts drain `popAppEvent` and dispatch to their UI
   *  store here. */
  onServerFrame?: () => void;
  /** `probeAuth` resolved `false`. The bridge has stopped and will
   *  not reconnect; the host should tear down the session. */
  onAuthFailed?: () => void;
  /** Surface protocol-level engine events (`popEvent`) — errors,
   *  protocol-version warnings, etc. If unset, events are still
   *  drained (so the engine queue can't grow unbounded) but
   *  discarded. */
  onEngineEvent?: (ev: EngineEvent) => void;
  /** Default 1500ms. Tests typically pass something tiny. */
  reconnectDelayMs?: number;
}

const DEFAULT_RECONNECT_DELAY_MS = 1500;

export class SyncBridge {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly reconnectDelayMs: number;

  constructor(private readonly opts: SyncBridgeOpts) {
    this.reconnectDelayMs = opts.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    // Best-effort engine notification; if already Disconnected this is a no-op.
    this.opts.engine.handleDisconnected();
  }

  /** Caller signal: local mutations may have produced new outbox
   *  bytes. Drain and flush. */
  pumpOutbox(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (true) {
      const bytes = this.opts.engine.popOutbox();
      if (!bytes) break;
      this.ws.send(bytes);
    }
    this.opts.onChange?.("drain");
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = this.opts.socketFactory();
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.opts.engine.handleConnected();
      this.pumpOutbox();
      this.drainEngineEvents();
      this.opts.onServerFrame?.();
      this.opts.onChange?.("online");
    };
    ws.onmessage = (ev) => {
      const data =
        ev.data instanceof ArrayBuffer
          ? new Uint8Array(ev.data)
          : ArrayBuffer.isView(ev.data)
            ? new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength)
            : null;
      if (!data) return; // text frames ignored
      this.opts.engine.handleServerBytes(data);
      this.pumpOutbox();
      this.drainEngineEvents();
      this.opts.onServerFrame?.();
    };
    ws.onclose = () => {
      this.opts.engine.handleDisconnected();
      this.opts.onChange?.("offline");
      this.ws = null;
      if (this.stopped) return;
      if (!opened) {
        // Pre-open close: upgrade itself may have been rejected (e.g.
        // revoked device token). Probe to disambiguate from a plain
        // network drop before scheduling the next attempt.
        void this.probeAndReconnect();
      } else {
        this.timer = setTimeout(() => this.connect(), this.reconnectDelayMs);
      }
    };
    ws.onerror = () => {
      // onclose runs after onerror; let onclose drive reconnect.
    };
  }

  private async probeAndReconnect(): Promise<void> {
    const probe = this.opts.probeAuth;
    if (probe) {
      const ok = await probe();
      if (!ok) {
        this.stopped = true;
        this.opts.onAuthFailed?.();
        return;
      }
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => this.connect(), this.reconnectDelayMs);
  }

  private drainEngineEvents(): void {
    const cb = this.opts.onEngineEvent;
    while (true) {
      const ev = this.opts.engine.popEvent();
      if (!ev) break;
      cb?.(ev);
    }
  }
}
