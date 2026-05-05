// WebSocket pump bridging a `SyncEngine` to a browser `WebSocket`.
// The engine is sans-IO; this file is the thin browser transport
// adapter described by `spec/architecture.md`. Reconnect is
// fixed-delay (no backoff). Auth is the `airday_device` cookie — sent
// automatically by the browser on the WS upgrade — so this module
// never sees the device token.

import type { SyncEngine } from "@airday/core/wasm";
import { api, ApiError } from "./api.ts";

export interface SyncBridgeOpts {
  engine: SyncEngine;
  /** Connection-state flips. Domain-level state changes flow through
   *  the engine's `AppEvent` queue instead — `onAppEvents` below. */
  onChange: (kind: "online" | "offline" | "drain") => void;
  /** Called after every server frame so the host can drain the
   *  doc's `AppEvent` queue and dispatch into its UI store. */
  onAppEvents: () => void;
  /** Server rejected the device cookie (revoked, password reset
   *  elsewhere, etc.). Bridge has stopped reconnecting; host should
   *  tear down the session. Browsers don't surface the upgrade's HTTP
   *  status to JS, so we detect this via an HTTP probe after a
   *  pre-open close — see `probeAndReconnect`. */
  onAuthFailed: () => void;
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
    const ws = new WebSocket(wsUrl());
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      // eslint-disable-next-line no-console
      console.debug("ws open");
      this.opts.engine.handleConnected();
      this.pumpOutbox();
      this.drainEngineEvents();
      this.opts.onAppEvents();
      this.opts.onChange("online");
    };
    ws.onmessage = (ev) => {
      const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : null;
      if (!data) return; // text frames are ignored
      // eslint-disable-next-line no-console
      console.debug("ws recv", data.length, "bytes");
      this.opts.engine.handleServerBytes(data);
      this.pumpOutbox();
      this.drainEngineEvents();
      // Domain deltas accumulated by `apply_remote` flow into the doc's
      // queue; the host drains them and dispatches to the Solid store.
      this.opts.onAppEvents();
    };
    ws.onclose = (ev) => {
      // eslint-disable-next-line no-console
      console.debug("ws close", ev.code, ev.reason, "stopped=", this.stopped);
      this.opts.engine.handleDisconnected();
      this.opts.onChange("offline");
      this.ws = null;
      if (this.stopped) return;
      if (!opened) {
        // Pre-open close: the upgrade itself may have been rejected
        // (e.g. revoked device token). Probe to disambiguate from a
        // plain network drop before scheduling the next attempt.
        void this.probeAndReconnect();
      } else {
        this.timer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    };
    ws.onerror = () => {
      // onclose runs after onerror; let onclose handle reconnect.
    };
  }

  private async probeAndReconnect(): Promise<void> {
    try {
      await api.listDevices();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Server says we're not authed. Stop reconnecting and let
        // the host tear down the session.
        this.stopped = true;
        this.opts.onAuthFailed();
        return;
      }
      // Network failure or unrelated error — fall through to reconnect.
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  }

  private drainEngineEvents(): void {
    while (true) {
      const ev = this.opts.engine.popEvent();
      if (!ev) break;
      if (ev.kind === "error") {
        // Surface engine errors to the console so dev-time debugging
        // doesn't require re-instrumenting the bridge.
        // eslint-disable-next-line no-console
        console.error("sync engine:", ev.message);
      }
    }
  }
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/sync`;
}
