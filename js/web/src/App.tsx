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
import { getDevice, IdbStorage, putDevice } from "@airday/core";
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
      when={session() !== undefined}
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
  /** Engine op-log store (IndexedDB `airday-engine`). Mandatory — the
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
}) {
  const { m } = useAppI18n();
  // Rebuild the doc from the engine op log (`spec/local-storage-plan.md`
  // Phase 2), mirroring the CLI's `boot_doc`: load the snapshot (a bare
  // Loro snapshot) and replay every op row after it via
  // `importWalUpdates`, then `markPushed()` so the engine's push cursor
  // covers the replayed ops (unacked ones re-push from the persisted
  // outbox, not `pending_export`). Fresh signups — and brand-new
  // anonymous docs with an empty store — start from `Doc.create()` so
  // the seeded built-ins land; authed devices with an empty store start
  // empty and let sync deliver a snapshot.
  void (async () => {
    try {
      // Prefs are independent of the op-log replay — fire in parallel so
      // they don't add a serial roundtrip to first paint. A miss (first
      // run for this account on this device) resolves null and `MainApp`
      // falls back to defaults.
      const prefsPromise = loadPrefs(props.session.accountId).catch(() => null);
      const dek = props.session.dek;
      const storage = await IdbStorage.open(props.session.primaryDocId);
      const device = props.session.anonymous
        ? null
        : await getDevice(props.session.accountId).catch(() => null);
      const rows = storage.bootRows();

      let doc: Doc;
      let seeded = false;
      if (props.session.freshSignup) {
        doc = Doc.create();
        seeded = true;
      } else if (rows.snapshot || rows.replay.length > 0) {
        doc = Doc.empty();
        if (rows.snapshot) {
          doc.importWalUpdates(
            dek.open(new EncryptedBlob(rows.snapshot.nonce, rows.snapshot.ciphertext)),
          );
        }
        for (const r of rows.replay) {
          doc.importWalUpdates(dek.open(new EncryptedBlob(r.nonce, r.ciphertext)));
        }
        doc.markPushed();
      } else if (props.session.anonymous) {
        // Brand-new (or wiped) local-only doc — seed the built-ins.
        doc = Doc.create();
        seeded = true;
      } else {
        // Authed device, empty local store — sync will send a snapshot.
        doc = Doc.empty();
      }

      props.setBoot({
        doc,
        lastAcked: BigInt(device?.lastAckedSeq ?? 0),
        storage,
        lastLocalSeq: rows.lastLocalSeq,
        seeded,
        prefs: await prefsPromise,
      });
    } catch (e) {
      // Storage is mandatory now (the engine has no storage-less mode):
      // a failure to open IDB or rebuild the doc is fatal. Surface it
      // rather than booting a broken engine.
      // eslint-disable-next-line no-console
      console.error("[boot] FAILED:", e);
      props.setBootError(e instanceof Error ? e.message : String(e));
    }
  })();

  return (
    <Show
      when={!props.bootError}
      fallback={<div class="empty">Failed to start: {props.bootError}</div>}
    >
      <Show when={props.boot} fallback={<div class="empty">{m().common.loading}</div>}>
        {(b) => (
          <MainApp
            session={props.session}
            boot={b()}
            setOnline={props.setOnline}
            online={props.online}
            lastSyncAt={props.lastSyncAt}
            setLastSyncAt={props.setLastSyncAt}
            logout={props.logout}
            onSession={props.onSession}
          />
        )}
      </Show>
    </Show>
  );
}

function MainApp(props: {
  session: Session;
  boot: BootInfo;
  online: boolean;
  setOnline: (b: boolean) => void;
  lastSyncAt: number | null;
  setLastSyncAt: (ts: number | null) => void;
  logout: () => void;
  onSession: (s: Session) => void;
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
  // The engine's `LocalStorage` trait does the heavy lifting now: local
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
      // eslint-disable-next-line no-console
      console.error("captureLocalOps failed:", e);
    }
  };
  const compact = (): void => {
    try {
      engine.snapshotIfFullySynced();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("snapshotIfFullySynced failed:", e);
    }
  };

  // Persist the device row (sync identity + durable resume cursor).
  // Anonymous sessions skip — there's no server identity to record. We
  // persist the *durable* frontier (`lastDurableSeq`), not the in-memory
  // `lastContiguousSeq`, so a crash never resumes from a seq the local
  // store doesn't actually cover.
  const persistDeviceNow = async (): Promise<void> => {
    if (props.session.anonymous) return;
    await putDevice(props.session.accountId, {
      accountId: props.session.accountId,
      primaryDocId: props.session.primaryDocId,
      email: props.session.email!,
      serverUrl: window.location.origin,
      deviceId: props.session.deviceId!,
      lastAckedSeq: Number(engine.lastDurableSeq()),
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
        engine.notifyWalDurable(seq);
        bridge?.pumpOutbox();
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
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
        // inside `handleServerBytes`. Compact if that drained the
        // outbox, then ratchet the durable cursor once the writes land.
        compact();
        scheduleDurable();
        saveDeviceSoon();
      },
      onAuthFailed: () => void props.logout(),
    });
    const b = bridge;
    app.setOnFlush(() => {
      b.pumpOutbox();
      compact();
      scheduleDurable();
    });
    bridge.start();
    onCleanup(() => b.stop());
  }

  // ---------- Device config: light writes on each frontier change ----------
  //
  // `lastAckedSeq` advances independently of mutations. Persist it on
  // a coarse debounce so reload picks up the right resume point.
  let deviceTimer: ReturnType<typeof setTimeout> | null = null;
  const saveDeviceSoon = (): void => {
    if (props.session.anonymous) return;
    if (deviceTimer) clearTimeout(deviceTimer);
    deviceTimer = setTimeout(() => {
      deviceTimer = null;
      void persistDeviceNow().catch((e) => {
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
        if (props.session.anonymous) engine.forceSnapshot();
        else engine.snapshotIfFullySynced();
      } catch (e) {
        // eslint-disable-next-line no-console
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
