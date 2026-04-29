// WebSocket pump bridging a `SyncEngine` to a browser `WebSocket`.
// The engine is sans-IO; this file is the thin transport adapter
// described in `sync-engine.md`. Reconnect is fixed-delay (no
// backoff); ticket-exchange auth is deferred — the device token
// rides on the URL per the slice-4 plan.

import type { SyncEngine } from "@airday/core/wasm";

export interface SyncBridgeOpts {
  engine: SyncEngine;
  /** Base URL of the airday server (e.g. http://localhost:8000). */
  serverUrl: string;
  /** Device token from /api/account/login. */
  deviceToken: string;
  /** Called whenever the engine emits an event (incl. `opsApplied`),
   *  on each new outbox drain, and on connection state flips. The
   *  caller uses this to bump its UI store. */
  onChange: (kind: "online" | "offline" | "ops" | "drain") => void;
}

const RECONNECT_DELAY_MS = 1500;

export class SyncBridge {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly opts: SyncBridgeOpts) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    // Best-effort engine notification; if the engine is already
    // Disconnected this is a no-op.
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
    this.opts.onChange("drain");
  }

  private connect(): void {
    if (this.stopped) return;
    const url = wsUrl(this.opts.serverUrl, this.opts.deviceToken);
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      // eslint-disable-next-line no-console
      console.debug("ws open");
      this.opts.engine.handleConnected();
      this.pumpOutbox();
      this.drainEvents();
      this.opts.onChange("online");
    };
    ws.onmessage = (ev) => {
      const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : null;
      if (!data) return; // text frames are ignored
      // eslint-disable-next-line no-console
      console.debug("ws recv", data.length, "bytes");
      this.opts.engine.handleServerBytes(data);
      this.pumpOutbox();
      this.drainEvents();
    };
    ws.onclose = (ev) => {
      // eslint-disable-next-line no-console
      console.debug("ws close", ev.code, ev.reason, "stopped=", this.stopped);
      this.opts.engine.handleDisconnected();
      this.opts.onChange("offline");
      this.ws = null;
      if (!this.stopped) {
        this.timer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    };
    ws.onerror = () => {
      // onclose runs after onerror; let onclose handle reconnect.
    };
  }

  private drainEvents(): void {
    let sawOps = false;
    while (true) {
      const ev = this.opts.engine.popEvent();
      if (!ev) break;
      if (ev.kind === "opsApplied") sawOps = true;
      if (ev.kind === "error") {
        // Surface engine errors to the console so dev-time debugging
        // doesn't require re-instrumenting the bridge.
        // eslint-disable-next-line no-console
        console.error("sync engine:", ev.message);
      }
    }
    if (sawOps) this.opts.onChange("ops");
  }
}

function wsUrl(serverUrl: string, token: string): string {
  const u = new URL("/api/sync", serverUrl);
  u.protocol = u.protocol.replace(/^http/, "ws");
  u.searchParams.set("token", token);
  return u.toString();
}
