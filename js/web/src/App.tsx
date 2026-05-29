// Top-level app. First visit auto-creates a local-only anonymous
// session (DEK generated client-side, no server account) and drops
// straight into the workspace — no auth gate. Sync stays off until
// the user signs up or logs in via Settings, which swaps the
// anonymous session for an authenticated one and clobbers the local
// doc (option C — punt the migration; document is in `phoenix.md`).
// After auth the UI is the same shape as the Doc-only build but
// every read / mutation goes through the engine so peer ops apply
// live.

import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Dek, Doc, EncryptedBlob, SyncEngine } from "@airday/core/wasm";
import { bootWal, IdbWalStorage, probeOpfs, WalBridge } from "@airday/core";
import { loadPrefs, savePrefs, type Prefs, type ViewKey } from "./prefs.ts";
import { api } from "./api.ts";
import { dekVault } from "./sync/dekVault.ts";
import { useAppI18n } from "./i18n.tsx";
import { type Session } from "./Login.tsx";
import { createSyncedApp } from "./sync/store.ts";
import { createSyncBridge, SyncBridge } from "./sync/sync.ts";
import { Workspace } from "./Workspace.tsx";

const CLIENT_NAME = "airday-web";
const CLIENT_VERSION = "0.1.0";
const SINGLE_TAB_LOCK_NAME = "airday-single-tab";

export function App() {
  const { m } = useAppI18n();
  const [gate, setGate] = createSignal<"checking" | "allowed" | "blocked">(
    "checking",
  );

  onMount(() => {
    if (!shouldEnforceSingleTab()) {
      setGate("allowed");
      return;
    }
    if (!("locks" in navigator) || !navigator.locks) {
      console.warn("navigator.locks unavailable; single-tab gate disabled");
      setGate("allowed");
      return;
    }

    let release: (() => void) | null = null;
    void navigator.locks.request(
      SINGLE_TAB_LOCK_NAME,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          setGate("blocked");
          return;
        }
        setGate("allowed");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );

    onCleanup(() => {
      release?.();
    });
  });

  return (
    <Show when={gate() !== "checking"} fallback={<div class="empty">{m().common.loading}</div>}>
      <Show
        when={gate() === "allowed"}
        fallback={
          <div class="empty">
            Airday is already open in another tab.
          </div>
        }
      >
        <AppBody />
      </Show>
    </Show>
  );
}

function AppBody() {
  const { m, locale, direction } = useAppI18n();
  createEffect(() => {
    document.documentElement.lang = locale();
    document.documentElement.dir = direction();
  });
  // `undefined` = vault probe still in flight; once it resolves we
  // either restore the persisted session or auto-mint a fresh
  // anonymous one — `session()` is never null after that point.
  const [session, setSession] = createSignal<Session | undefined>(undefined);
  const [online, setOnline] = createSignal(false);
  // Wall-clock timestamp of the last successful server frame (recv or
  // outbox flush). Reset on logout/session-swap so the new account
  // doesn't inherit the previous device's last-synced time.
  const [lastSyncAt, setLastSyncAt] = createSignal<number | null>(null);
  const [boot, setBoot] = createSignal<BootInfo | null>(null);
  const [bootError, setBootError] = createSignal<string | null>(null);
  const [opfsOk, setOpfsOk] = createSignal<boolean | null>(null);

  void (async () => {
    const ok = await probeOpfs();
    if (!ok) console.warn("OPFS not available");
    setOpfsOk(ok);
  })();

  // Probe the vault on mount. If a wrapped DEK is present and we can
  // unwrap it, restore that session — for authenticated records, the
  // device cookie should still be valid (the WS pump will surface the
  // failure if it isn't); for anonymous records, OPFS is the source
  // of truth. If there's no record at all, mint a fresh anonymous
  // session so the user lands directly in the app.
  void (async () => {
    try {
      const v = await dekVault.load();
      if (v) {
        setSession({
          anonymous: v.anonymous,
          email: v.email,
          accountId: v.accountId,
          primaryDocId: v.primaryDocId,
          deviceId: v.deviceId,
          dek: v.dek,
          freshSignup: false,
        });
        return;
      }
    } catch (e) {
      console.warn("vault load failed:", e);
    }
    setSession(await createAnonymousSession());
  })();

  // Logout: tear down server-side state and replace the session with
  // a fresh anonymous one. Anonymous sessions also flow through here
  // (e.g. "discard local data") — `api.logout` no-ops cleanly when
  // there's no device cookie.
  const logout = async () => {
    const current = session();
    if (current && !current.anonymous) {
      try {
        await api.logout();
      } catch (e) {
        // Best-effort: even if the server call fails (offline, expired
        // cookie), drop local state so the next login is clean.
        console.warn("logout call failed:", e);
      }
    }
    await dekVault.clear();
    setBoot(null);
    setBootError(null);
    setOnline(false);
    setLastSyncAt(null);
    setSession(await createAnonymousSession());
  };

  const onAuthenticated = (s: Session) => {
    // Local-only anonymous data is left to drift in OPFS under the
    // old anon accountId. It'll never be addressed again — option C
    // says clobber, not migrate. A future cleanup pass can reap it.
    setBoot(null);
    setBootError(null);
    setOnline(false);
    setLastSyncAt(null);
    setSession(s);
  };

  return (
    <Show
      when={session() !== undefined && opfsOk() !== null}
      fallback={<div class="empty">{m().common.loading}</div>}
    >
      <Show keyed when={session()}>
        {(s) => (
          <BootGate
            session={s}
            boot={boot()}
            bootError={bootError()}
            setBoot={setBoot}
            setBootError={setBootError}
            online={online()}
            setOnline={setOnline}
            lastSyncAt={lastSyncAt()}
            setLastSyncAt={setLastSyncAt}
            logout={logout}
            onSession={onAuthenticated}
            opfsOk={opfsOk() ?? false}
          />
        )}
      </Show>
    </Show>
  );
}

function shouldEnforceSingleTab(): boolean {
  const flag = (import.meta.env as Record<string, string | boolean | undefined>)[
    "VITE_ENFORCE_SINGLE_TAB"
  ];
  if (flag === "0") return false;
  if (flag === "1") return true;

  const url = new URL(window.location.href);
  if (url.searchParams.get("multiTab") === "1") return false;

  return !import.meta.env.DEV;
}

async function createAnonymousSession(): Promise<Session> {
  const accountId = `anon-${crypto.randomUUID()}`;
  // Anonymous sessions never reach the server, so there's no
  // server-assigned doc id to use. Mint one locally; matches the
  // shape authenticated sessions get from signup/login responses.
  const primaryDocId = crypto.randomUUID();
  const dek = Dek.generate();
  const session: Session = {
    anonymous: true,
    accountId,
    primaryDocId,
    email: null,
    deviceId: null,
    dek,
    // Seed the doc on first run via Doc.create(). On reload we read
    // OPFS instead.
    freshSignup: true,
  };
  try {
    await dekVault.save({
      anonymous: true,
      accountId,
      primaryDocId,
      email: null,
      deviceId: null,
      dek: dek.clone(),
    });
  } catch (e) {
    console.warn("dekVault.save failed for anonymous session:", e);
  }
  return session;
}

type BootInfo = {
  doc: Doc;
  lastAcked: bigint;
  wal: IdbWalStorage | null;
  /** Whatever was in the `prefs` store for this account at boot. Null
   *  if the row was missing (first run for this account on this
   *  device). `MainApp` consumes the fields it cares about. */
  prefs: Prefs | null;
};

function BootGate(props: {
  session: Session;
  boot: BootInfo | null;
  bootError: string | null;
  setBoot: (b: BootInfo | null) => void;
  setBootError: (m: string | null) => void;
  online: boolean;
  setOnline: (b: boolean) => void;
  lastSyncAt: number | null;
  setLastSyncAt: (ts: number | null) => void;
  logout: () => void;
  onSession: (s: Session) => void;
  opfsOk: boolean;
}) {
  const { m } = useAppI18n();
  // Restore the doc per `spec/idb-wal.md`: load the committed OPFS
  // snapshot, then replay every IndexedDB WAL row strictly after
  // `snapshot_wal_seq`. On signup we still start with a fresh
  // `Doc.create()` so the seeded built-ins land. Without OPFS we
  // can't snapshot (and IDB-only would orphan the WAL on reload), so
  // fall through to an empty doc that sync catches up.
  void (async () => {
    const t0 = performance.now();
    const tap = (label: string, t: number) => {
      // eslint-disable-next-line no-console
      console.debug(`[boot] ${label.padEnd(28)} ${(t - t0).toFixed(1)}ms`);
    };
    try {
      // Prefs are independent of the WAL replay — fire in parallel
      // so they don't add a serial roundtrip to first paint. Both are
      // small keyed IDB reads against the same DB. A miss (first run
      // for this account on this device) resolves null and `MainApp`
      // falls back to defaults.
      const prefsPromise = loadPrefs(props.session.accountId).catch(() => null);
      if (props.session.freshSignup) {
        const wal = await tryInitWal(props.session, props.opfsOk);
        tap("freshSignup wal init", performance.now());
        props.setBoot({
          doc: Doc.create(),
          lastAcked: 0n,
          wal,
          prefs: await prefsPromise,
        });
        return;
      }
      if (!props.opfsOk) {
        props.setBoot({
          doc: Doc.empty(),
          lastAcked: 0n,
          wal: null,
          prefs: await prefsPromise,
        });
        return;
      }
      const wal = new IdbWalStorage(
        props.session.accountId,
        props.session.primaryDocId,
        props.session.dek.clone(),
        EncryptedBlob,
      );
      const { doc, device, replayErrors } = await bootWal({
        wal,
        emptyDoc: () => Doc.empty(),
        loadDoc: (snap) => Doc.load(snap),
      });
      tap("bootWal done", performance.now());
      for (const { walSeq, error } of replayErrors) {
        // eslint-disable-next-line no-console
        console.warn(`wal replay failed at seq ${walSeq}:`, error);
      }
      props.setBoot({
        doc,
        lastAcked: BigInt(device?.lastAckedSeq ?? 0),
        wal,
        prefs: await prefsPromise,
      });
    } catch (e) {
      props.setBootError(e instanceof Error ? e.message : String(e));
      props.setBoot({
        doc: Doc.empty(),
        lastAcked: 0n,
        wal: null,
        prefs: null,
      });
    }
  })();

  return (
    <Show when={props.boot} fallback={<div class="empty">{m().common.loading}</div>}>
      {(b) => (
        <MainApp
          session={props.session}
          boot={b()}
          bootError={props.bootError}
          setOnline={props.setOnline}
          online={props.online}
          lastSyncAt={props.lastSyncAt}
          setLastSyncAt={props.setLastSyncAt}
          logout={props.logout}
          onSession={props.onSession}
          opfsOk={props.opfsOk}
        />
      )}
    </Show>
  );
}

/** Initialise an empty WAL store for a freshly-signed-up session so
 *  the first commits land in IDB even before the first snapshot. */
async function tryInitWal(
  session: Session,
  opfsOk: boolean,
): Promise<IdbWalStorage | null> {
  if (!opfsOk) return null;
  const wal = new IdbWalStorage(
    session.accountId,
    session.primaryDocId,
    session.dek.clone(),
    EncryptedBlob,
  );
  await wal.loadForReplay();
  return wal;
}

function MainApp(props: {
  session: Session;
  boot: BootInfo;
  bootError: string | null;
  online: boolean;
  setOnline: (b: boolean) => void;
  lastSyncAt: number | null;
  setLastSyncAt: (ts: number | null) => void;
  logout: () => void;
  onSession: (s: Session) => void;
  opfsOk: boolean;
}) {
  // eslint-disable-next-line no-console
  console.debug(
    "MainApp mount, freshSignup=",
    props.session.freshSignup,
    "lastAckedBlob=",
    String(props.boot.lastAcked),
  );
  // Both SyncEngine and the WAL store consume their Dek argument, and
  // the session-level Dek must stay valid across MainApp remounts
  // (anonymous → authed swap remounts this whole tree on the Session
  // key). So clone for each consumer; the original on
  // `props.session.dek` is untouched.
  const engine = new SyncEngine(
    props.boot.doc,
    props.session.primaryDocId,
    props.session.dek.clone(),
    props.boot.lastAcked,
    CLIENT_NAME,
    CLIENT_VERSION,
  );
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

  const wal = props.boot.wal;

  // ---------- WAL: per-commit capture + snapshot scheduling ----------
  //
  // `WalBridge` owns the cursor + serialised append chain + threshold-
  // triggered snapshot path (see `js/core/src/wal-bridge.ts`). All the
  // web layer wires is when to call `captureAndAppend()` (after local
  // commits and after server frames) and `snapshotNow()` (on tab
  // hide). Without OPFS we skip the bridge entirely — IDB-only would
  // orphan the WAL on reload, so we fall back to engine-only state
  // that sync catches up.
  //
  // Fresh-signup cursor: `Doc.create()` already happened in boot, so
  // the seeded built-ins are in the oplog. Start at empty so the very
  // first capture emits them as `wal_seq = 1` (per spec/idb-wal.md
  // "Fresh Account"). For replay-restored boots we start at the
  // current oplog VV so we don't re-emit replayed rows.
  //
  // After every snapshot (threshold-triggered or host-forced) also
  // persist the device row so reload picks up the right resume point
  // even if no debounced `saveDeviceSoon` write has landed yet.
  // Anonymous sessions skip — there's no server identity to record.
  const persistDevice = async (): Promise<void> => {
    if (!wal || props.session.anonymous) return;
    await wal.putDevice({
      accountId: props.session.accountId,
      primaryDocId: props.session.primaryDocId,
      email: props.session.email!,
      // Bundle is served from the same origin as the API; record that
      // origin for completeness even though the cookie is the
      // load-bearing piece of "which server am I talking to".
      serverUrl: window.location.origin,
      deviceId: props.session.deviceId!,
      // Persist the *durable* frontier — what the server has been
      // (or will be) told via `Ack`, and what the local WAL actually
      // covers. The in-memory `lastContiguousSeq` may run ahead and
      // would resume the next session from a seq the local doc can't
      // reproduce after a crash mid-WAL-write.
      lastAckedSeq: Number(engine.lastDurableSeq()),
      lastSyncAt: Date.now(),
    });
  };

  // Anonymous sessions are local-only by definition — no account on
  // the server to authenticate to. Skip the WebSocket pump entirely;
  // local mutations still flow through the engine for WAL persist.
  let bridge: SyncBridge | null = null;
  const walBridge: WalBridge | null = wal
    ? new WalBridge({
        engine,
        wal,
        initialCursor: props.session.freshSignup
          ? new Uint8Array(0)
          : engine.oplogVvBytes(),
        afterSnapshot: persistDevice,
        // Once the WAL row is durable the engine has queued the
        // corresponding `Ack` frame — pump so it leaves the socket
        // without waiting for the next inbound frame to incidentally
        // trigger a drain. The closure captures the `bridge` binding,
        // not its value, so the late assignment below is picked up.
        onDurable: () => bridge?.pumpOutbox(),
      })
    : null;
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
        // Server frame applied → capture remote-imported ops too. Cheap
        // when nothing changed (export returns 0 bytes).
        walBridge?.captureAndAppend();
      },
      onAuthFailed: () => void props.logout(),
    });
    const b = bridge;
    app.setOnFlush(() => {
      walBridge?.captureAndAppend();
      b.pumpOutbox();
    });
    bridge.start();
    onCleanup(() => b.stop());
  } else {
    // Anonymous: still capture local commits for WAL durability.
    app.setOnFlush(() => walBridge?.captureAndAppend());
  }


  // ---------- Device config: light writes on each frontier change ----------
  //
  // `lastAckedSeq` advances independently of mutations. Persist it on
  // a coarse debounce so reload picks up the right resume point even
  // if no snapshot lands in between.
  let deviceTimer: ReturnType<typeof setTimeout> | null = null;
  const saveDeviceSoon = (): void => {
    if (!wal || props.session.anonymous) return;
    if (deviceTimer) clearTimeout(deviceTimer);
    deviceTimer = setTimeout(() => {
      deviceTimer = null;
      void wal
        .putDevice({
          accountId: props.session.accountId,
          primaryDocId: props.session.primaryDocId,
          email: props.session.email!,
          serverUrl: window.location.origin,
          deviceId: props.session.deviceId!,
          // See persistDevice — durable, not contiguous.
          lastAckedSeq: Number(engine.lastDurableSeq()),
          lastSyncAt: Date.now(),
        })
        .catch((e) => {
          // eslint-disable-next-line no-console
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
          // eslint-disable-next-line no-console
          console.error("prefs save failed:", e);
        });
      },
      { defer: true },
    ),
  );

  // Fresh signup: capture the seeded built-ins as the first WAL row so
  // a reload before any user mutation has something to replay. Cursor
  // is initialised to empty above, so this single call exports
  // everything in the doc since genesis. Snapshots are then triggered
  // strictly by the WAL-threshold path — no special-case OPFS write at
  // signup, which keeps `commitSnapshot` from ever being called twice
  // with the same `snapshotWalSeq` (the same-seq case would overwrite a
  // currently-committed snapshot file in place; see spec/idb-wal.md
  // "Atomicity Rule").
  if (walBridge && props.session.freshSignup) {
    walBridge.captureAndAppend();
  }

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      // Drain WAL appends in flight, then commit a snapshot so the
      // next boot has a fresh base. Best-effort — IDB writes already
      // queued behind the bridge's append chain will land regardless
      // of whether the snapshot fires before the page goes away.
      if (deviceTimer) clearTimeout(deviceTimer);
      void walBridge?.snapshotNow();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (deviceTimer) clearTimeout(deviceTimer);
  });

  if (typeof window !== "undefined") {
    (window as any).__airday = { app, engine, bridge, wal };
  }

  return (
    <Workspace
      app={app}
      session={props.session}
      online={props.online}
      lastSyncAt={props.lastSyncAt}
      logout={props.logout}
      onSession={props.onSession}
      view={view}
      setView={setView}
    />
  );
}
