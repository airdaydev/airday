// WebSocket pump + lifecycle around a sans-IO `SyncEngine`. Owned by
// the JS host (not the wasm core) so each platform — web and bun-based
// tests — can drive the same engine with the same reconnect / auth
// policy by injecting only the bits that differ:
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
// Reconnect uses exponential backoff with jitter, capped at `maxMs`.
// The attempt counter resets on a successful `onopen`. Hosts can
// short-circuit the backoff timer with `reconnectNow()` — that's the
// hook platform layers wire to visibility/online events.

import type { EngineEvent, SyncEngine } from "../wasm/airday_core_web.js";

export type ConnectionEvent = "online" | "offline" | "drain";

export interface ReconnectBackoff {
  /** Delay before the first retry. Subsequent retries double until
   *  capped at `maxMs`. Default 500ms. */
  baseMs?: number;
  /** Cap on the exponentially-grown delay. Default 30_000ms. */
  maxMs?: number;
  /** Jitter as a fraction of the computed delay; 0.2 = ±20%.
   *  Default 0.2. Set to 0 for deterministic tests. */
  jitter?: number;
}

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
  /** Exponential-backoff parameters. Defaults: base 500ms, cap 30s,
   *  ±20% jitter. */
  reconnectBackoff?: ReconnectBackoff;
}

const DEFAULT_BASE_MS = 500;
const DEFAULT_MAX_MS = 30_000;
const DEFAULT_JITTER = 0.2;
/** Cadence at which the bridge calls `engine.handleTimeout()` to drive
 *  the `Hello` handshake watchdog. 1s polling keeps wake-up cost
 *  negligible. */
const TICK_INTERVAL_MS = 1_000;

export class SyncBridge {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private attempt = 0;
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly jitter: number;

  constructor(private readonly opts: SyncBridgeOpts) {
    const b = opts.reconnectBackoff;
    this.baseMs = b?.baseMs ?? DEFAULT_BASE_MS;
    this.maxMs = b?.maxMs ?? DEFAULT_MAX_MS;
    this.jitter = b?.jitter ?? DEFAULT_JITTER;
  }

  start(): void {
    this.connect();
    if (!this.tickTimer) {
      // Periodic tick drives the engine's handshake watchdog. Cheap —
      // outside the Hello handshake, `handleTimeout` is a no-op.
      this.tickTimer = setInterval(() => {
        this.opts.engine.handleTimeout();
        this.pumpOutbox();
        this.drainEngineEvents();
      }, TICK_INTERVAL_MS);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    // Best-effort engine notification; if already Disconnected this is a no-op.
    this.opts.engine.handleDisconnected();
  }

  /** Cancel any pending backoff timer and reconnect immediately.
   *  Hosts wire this to platform wake-ups (browser `online` /
   *  `visibilitychange`, native push). Cheap no-op if already
   *  connecting or stopped; the attempt counter is unchanged so
   *  repeated failed wake-ups still back off — only a successful
   *  `onopen` resets it. */
  reconnectNow(): void {
    if (this.stopped) return;
    if (this.ws) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.connect();
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
      this.attempt = 0;
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
        this.scheduleReconnect();
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
    // While the probe was in flight, the host may have called
    // `reconnectNow()` (or `stop()`); don't double-schedule.
    if (this.stopped || this.ws || this.timer) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const exp = Math.min(this.maxMs, this.baseMs * 2 ** this.attempt);
    const j = this.jitter > 0 ? 1 + (Math.random() * 2 - 1) * this.jitter : 1;
    const delay = Math.max(0, Math.round(exp * j));
    this.attempt++;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
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
