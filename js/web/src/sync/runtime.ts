// The imperative runtime behind the workspace: it owns the `SyncEngine`,
// the synced store, op-log persistence, device-row writes, and the
// WebSocket sync bridge for one booted session. `MainApp` calls this
// once during setup and renders the returned `app` / `view` — all the
// lifecycle (effects, `onCleanup`, the visibility handler) registers
// against the calling component's reactive owner, so this must be
// invoked synchronously from a component body, not an async callback.

import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { Doc, SyncEngine } from "@airday/core/wasm";
import { IdbStorage, putDevice } from "@airday/core";
import { savePrefs, type Prefs, type ViewKey } from "../prefs.ts";
import { type Session } from "../Login.tsx";
import { createSyncedApp } from "./store.ts";
import { createSyncBridge, SyncBridge } from "./sync.ts";

const CLIENT_NAME = "airday-web";
const CLIENT_VERSION = "0.1.0";

/** Everything `BootGate` rebuilds from the op log before the runtime can
 *  start: the doc, the durable cursors, and the opened store. */
export type BootInfo = {
  doc: Doc;
  lastAcked: bigint;
  /** Engine op-log store (the engine stores of IndexedDB `airday-web`).
   *  Mandatory — the
   *  engine has no storage-less mode; if IDB can't be opened the boot
   *  fails hard (see `BootGate`) rather than running without local
   *  persistence. */
  storage: IdbStorage;
  /** Highest `localSeq` the store has assigned — seeds the engine. */
  lastLocalSeq: number;
  /** True when the doc was freshly created (`Doc.create()`) and its
   *  seeded built-ins still need an initial `captureLocalOps`. */
  seeded: boolean;
  /** Whatever was in the `prefs` store for this account at boot. Null
   *  if the row was missing (first run for this account on this
   *  device). */
  prefs: Prefs | null;
};

export function createWorkspaceRuntime(props: {
  session: Session;
  boot: BootInfo;
  setOnline: (b: boolean) => void;
  setLastSyncAt: (ts: number | null) => void;
  logout: () => void;
}) {
  const storage = props.boot.storage;
  // `SyncEngine` consumes its Dek argument, and the session-level Dek
  // must stay valid across MainApp remounts (anonymous → authed swap
  // remounts this whole tree on the Session key). So clone for the
  // engine; the original on `props.session.dek` is untouched. The
  // `IdbStorage` mirror is handed in as the engine's `EngineStorage` —
  // capture / ack / remote-apply now flow through it.
  const engine = new SyncEngine(
    props.boot.doc,
    props.session.primaryDocId,
    props.session.dek.clone(),
    props.boot.lastAcked,
    CLIENT_NAME,
    CLIENT_VERSION,
    storage,
  );
  // Seed the engine's `localSeq` cursor from what the store loaded so
  // new appends continue past the persisted log.
  engine.setLastLocalSeq(props.boot.lastLocalSeq);
  const app = createSyncedApp(engine);

  if (import.meta.env.DEV) {
    (window as unknown as { __app: typeof app }).__app = app;
    onCleanup(() => {
      delete (window as unknown as { __app?: typeof app }).__app;
    });
  }

  // Workspace view lives at this level so the prefs-save effect
  // below can persist it independently of the device-frontier write.
  // Seed from the prefs row; a `kind:"list"` pointing at a
  // since-deleted list falls back to Home silently. `done`/`bin` are
  // global views and always resolvable.
  const initialView: ViewKey = (() => {
    const v = props.boot.prefs?.currentView;
    if (!v) return { kind: "list", id: "main" };
    if (v.kind === "list" && !app.state.listsById[v.id]) {
      return { kind: "list", id: "main" };
    }
    return v;
  })();
  const [view, setView] = createSignal<ViewKey>(initialView);

  // ---------- Engine op-log persistence (IdbStorage) ----------
  //
  // The engine's `LocalStorage` trait does the heavy lifting: local
  // commits become durable op rows via `captureLocalOps`, remote ops are
  // mirrored inside `handleServerBytes`, and the outbox drives the push.
  // The web host's job is just the CLI's `persist_engine_state` rhythm,
  // adapted for IDB's async durability:
  //
  //   - `capture()` (before every `flush()`) writes the just-committed
  //     mutation to a durable op row *before* the outbox-driven push
  //     reads it. This must precede `engine.flush()`.
  //   - `compact()` folds a fully-synced log into a fresh snapshot.
  //   - `scheduleDurable()` samples the contiguous seq, waits for the
  //     IDB write to actually land, then tells the engine the bytes are
  //     durable (which queues the `Ack`) and pumps it onto the wire.
  const capture = (): void => {
    try {
      engine.captureLocalOps();
    } catch (e) {
      console.error("captureLocalOps failed:", e);
    }
  };
  // Snapshot export is O(doc) on the main thread (tens of ms at ~10k
  // lifetime items under wasm), and this runs on the per-ack pulse —
  // i.e. one RTT after *every* local mutation. Unthresholded it turned
  // each keystroke into a whole-doc export; see spec/list-perf-plan.md.
  // So the hot pulse only folds once ≥250 op rows accumulated, and a
  // quiet-period timer (below) folds whatever's left so short sessions
  // don't boot into a long op-log replay.
  const COMPACT_MIN_OPS = 250;
  const COMPACT_IDLE_MS = 20_000;
  const compact = (minOps: number): void => {
    // Pull/bootstrap frames may install a server snapshot baseline. Do not
    // immediately export another whole-doc snapshot while that phase is in
    // progress; compaction starts only once catch-up reaches steady-state.
    if (!engine.isIdle()) return;
    try {
      engine.snapshotIfFullySynced(minOps);
    } catch (e) {
      console.error("snapshotIfFullySynced failed:", e);
    }
  };
  // Debounced idle fold-down: re-armed on every server round-trip, so
  // it fires once things go quiet. minOps=1 → folds any synced ops.
  let compactIdleTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleIdleCompact = (): void => {
    clearTimeout(compactIdleTimer);
    compactIdleTimer = setTimeout(() => compact(1), COMPACT_IDLE_MS);
  };
  onCleanup(() => clearTimeout(compactIdleTimer));

  // Persist the device row — identity + the "last synced" stamp
  // (observability only). The resume cursor is no longer stored here:
  // the engine owns it and persists it itself via
  // `IdbStorage.writeAckedSeq` (clamped to the durable contiguous
  // frontier). Anonymous sessions skip — no server identity to record.
  const persistDeviceNow = async (): Promise<void> => {
    if (props.session.anonymous) return;
    await putDevice(props.session.accountId, {
      accountId: props.session.accountId,
      primaryDocId: props.session.primaryDocId,
      email: props.session.email!,
      serverUrl: window.location.origin,
      deviceId: props.session.deviceId!,
      lastSyncAt: Date.now(),
    });
  };

  let bridge: SyncBridge | null = null;
  // Sample the contiguous seq now, wait for queued IDB writes to land,
  // then mark durable + ship the resulting Ack. Sampling synchronously
  // binds the notify to bytes that were actually being persisted.
  const scheduleDurable = (): void => {
    const seq = engine.lastContiguousSeq();
    storage
      .whenFlushed()
      .then(() => {
        engine.notifyOplogDurable(seq);
        bridge?.pumpOutbox();
      })
      .catch((e) => {
        console.error("durable flush failed:", e);
      });
  };

  // Capture local commits before the push reads the outbox — both
  // anonymous and authed need durable op rows.
  app.setBeforeFlush(capture);

  // Anonymous sessions are local-only by definition — no account on the
  // server to authenticate to. Skip the WebSocket pump entirely; local
  // commits still persist through `capture()` above.
  if (!props.session.anonymous) {
    bridge = createSyncBridge({
      engine,
      onChange: (kind) => {
        if (kind === "online") {
          props.setOnline(true);
          props.setLastSyncAt(Date.now());
        }
        if (kind === "offline") props.setOnline(false);
        // `drain` fires after every recv-frame pump and every outbox
        // flush, so it's the natural pulse for "we just round-tripped
        // with the server" — even when no app events were produced.
        if (kind === "drain") props.setLastSyncAt(Date.now());
      },
      onServerFrame: () => {
        app.drainEvents();
        // The engine already mirrored remote ops + acks into storage
        // inside `handleServerBytes`. Compact (thresholded — this pulse
        // fires one RTT after every mutation) if that drained the
        // outbox, then ratchet the durable cursor once the writes land.
        compact(COMPACT_MIN_OPS);
        scheduleIdleCompact();
        scheduleDurable();
        saveDeviceSoon();
      },
      onAuthFailed: () => void props.logout(),
    });
    const b = bridge;
    app.setOnFlush(() => {
      b.pumpOutbox();
      compact(COMPACT_MIN_OPS);
      scheduleIdleCompact();
      scheduleDurable();
    });
    bridge.start();
    onCleanup(() => b.stop());
  }

  // ---------- Device config: light writes on each frontier change ----------
  //
  // Refreshes the "last synced" stamp (observability) on a coarse
  // debounce. The resume cursor is persisted separately by the engine
  // (`IdbStorage.writeAckedSeq`), so this no longer carries it.
  let deviceTimer: ReturnType<typeof setTimeout> | null = null;
  const saveDeviceSoon = (): void => {
    if (props.session.anonymous) return;
    if (deviceTimer) clearTimeout(deviceTimer);
    deviceTimer = setTimeout(() => {
      deviceTimer = null;
      void persistDeviceNow().catch((e) => {
        console.error("device save failed:", e);
      });
    }, 500);
  };
  createEffect(() => {
    app.version();
    saveDeviceSoon();
  });

  // ---------- Prefs: separate store, write-through ----------
  //
  // View state ("which list / Done / Bin am I on?") lives in its own
  // IDB store keyed per account. Decoupled from `device` so a burst
  // of typing doesn't rewrite the view, and switching lists doesn't
  // rewrite the sync frontier. Anonymous sessions persist too — the
  // device row gate above is about identity, not local-only UI state.
  //
  // No debounce: view changes are user-initiated (click / keyboard
  // nav) and rare on the timescale of an IDB write. Coalescing them
  // would only buy us dropped saves when the tab closes mid-window.
  createEffect(
    on(
      view,
      () => {
        void savePrefs(props.session.accountId, {
          currentView: view(),
        }).catch((e) => {
          console.error("prefs save failed:", e);
        });
      },
      { defer: true },
    ),
  );

  // Freshly-created doc (signup, or a brand-new anonymous doc): persist
  // the seeded built-ins as the first op row so a reload before any user
  // mutation still has something to replay. The op row is unacked, so
  // for authed sessions it also pushes to the server via the outbox.
  if (props.boot.seeded) {
    capture();
    scheduleDurable();
  }

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      if (deviceTimer) clearTimeout(deviceTimer);
      // Persist any uncommitted local op, then compact so the next boot
      // has a fresh base. Anonymous sessions never sync, so their outbox
      // never drains and `snapshotIfFullySynced` would never fire —
      // force a full-state snapshot (prune-all) instead. Best-effort.
      capture();
      try {
        // Tab going hidden: fold everything synced regardless of the
        // hot-pulse threshold, so the next boot replays a short log.
        if (props.session.anonymous) engine.forceSnapshot();
        else engine.snapshotIfFullySynced(1);
      } catch (e) {
        console.error("snapshot on hide failed:", e);
      }
      void persistDeviceNow().catch(() => {});
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (deviceTimer) clearTimeout(deviceTimer);
  });

  return { app, view, setView };
}
