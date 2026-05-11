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
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Dek, Doc, EncryptedBlob, SyncEngine } from "@airday/core/wasm";
import { IdbWalStorage, probeOpfs } from "@airday/core";
import { loadPrefs, savePrefs, type Prefs, type ViewKey } from "./prefs.ts";
import { ContextMenu } from "@kobalte/core/context-menu";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Popover } from "@kobalte/core/popover";
import {
  Dnd,
  DndSelection,
  type DndImperative,
  type DndOp,
} from "./dnd/solid";
import type { DndDragEventDetail } from "./dnd";
import arrowRightSvg from "./icons/arrow-right.svg?raw";
import caretLeftSvg from "./icons/caret-left.svg?raw";
import checkSvg from "./icons/check.svg?raw";
import crumpledPaperSvg from "./icons/crumpled-paper.svg?raw";
import dotsVerticalSvg from "./icons/dots-vertical.svg?raw";
import menuSvg from "./icons/menu.svg?raw";
import plusSvg from "./icons/plus.svg?raw";
import trashSvg from "./icons/trash.svg?raw";
import { api } from "./api.ts";
import {
  caretXIfOnLastLine,
  focusEditableLastLineAtX,
  focusTextareaFirstLineAtX,
  textareaCaretXIfOnFirstLine,
} from "./caretBridge.ts";
import { dekVault } from "./dekVault.ts";
import { FindPalette } from "./FindPalette.tsx";
import { useAppI18n } from "./i18n.tsx";
import type { SearchResult } from "./search.ts";
import { AuthForm, type Session } from "./Login.tsx";
import { Settings } from "./Settings.tsx";
import {
  createSyncedApp,
  isBinned,
  isDone,
  isInListView,
  type DocApp,
  type ItemView,
  type ListView,
} from "./store.ts";
import { SyncBridge } from "./sync.ts";
import { createTheme, type ThemePreference } from "./theme.ts";

const CLIENT_NAME = "airday-web";
const CLIENT_VERSION = "0.1.0";
const SINGLE_TAB_LOCK_NAME = "airday-single-tab";

// Done items linger in their live list this long after being marked
// done, so the user sees the strike-through before the row drops out.
// The state change is instant — this is purely a render-time tail
// derived from doneAt, not a separate "pending" set.
const DONE_LINGER_MS = 3_000;

// Module-level so the OS-preference listener is registered exactly
// once for the lifetime of the page.
const theme = createTheme();

// Shared 60s tick for relative-time labels ("5m ago"). One signal, one
// interval — every Row that reads it stays fresh without spawning its
// own timer.
const [nowMs, setNowMs] = createSignal(Date.now());
setInterval(() => setNowMs(Date.now()), 60_000);

function calendarDayDiff(later: Date, earlier: Date): number {
  const a = new Date(later.getFullYear(), later.getMonth(), later.getDate()).getTime();
  const b = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

// Surface the most recent state-changing timestamp. Binned wins over
// done because it's the later transition: a done-then-binned item shows
// when it was binned in the Bin view; a plain done item shows doneAt in
// the Done view.
function statusTimestamp(it: ItemView): number | undefined {
  return it.binnedAt ?? it.doneAt;
}

// Draft items live only in the dnd's items list — never in the engine —
// until the user commits them. The id prefix is the discriminator the
// Row uses to switch between "edit existing" and "create new" save paths
// on collapse.
const DRAFT_ID_PREFIX = "__draft__";
const isDraftId = (id: string): boolean => id.startsWith(DRAFT_ID_PREFIX);

// Heuristic for "user has a real keyboard + precise pointer" — i.e. the
// shortcut hints are worth showing. Reactive: an iPad gaining a Magic
// Keyboard or a laptop docked to a touchscreen will flip live.
function createKbDeviceSignal(): () => boolean {
  const mql = window.matchMedia("(hover: hover) and (pointer: fine)");
  const [matches, setMatches] = createSignal(mql.matches);
  const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
  mql.addEventListener("change", onChange);
  onCleanup(() => mql.removeEventListener("change", onChange));
  return matches;
}

function formatRelative(ts: number, now: number, locale: string): string {
  const diffMs = now - ts;
  const m = locale.startsWith("es") ? relativeEs : relativeEn;
  const timeFmt = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const monthDayFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const monthDayYearFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (diffMs < 60_000) return m.justNow;
  if (diffMs < 3_600_000) return m.minutesAgo(Math.floor(diffMs / 60_000));
  if (diffMs < 86_400_000) return m.hoursAgo(Math.floor(diffMs / 3_600_000));
  const tsDate = new Date(ts);
  const nowDate = new Date(now);
  const days = calendarDayDiff(nowDate, tsDate);
  if (days === 1) return m.yesterdayAt(timeFmt.format(tsDate));
  if (days < 7) return `${weekdayFmt.format(tsDate)} ${timeFmt.format(tsDate)}`;
  if (tsDate.getFullYear() === nowDate.getFullYear()) return monthDayFmt.format(tsDate);
  return monthDayYearFmt.format(tsDate);
}

// Done-view stamp: same calendar day as `now` → time of day; otherwise
// the date. Strips the "X minutes ago" / "Yesterday HH:MM" / "Mon HH:MM"
// noise the relative format produces, since once a Done row ages past
// today the exact moment it got ticked off isn't useful — the date is.
function formatDoneStamp(ts: number, now: number, locale: string): string {
  const tsDate = new Date(ts);
  const nowDate = new Date(now);
  if (calendarDayDiff(nowDate, tsDate) === 0) {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(tsDate);
  }
  if (tsDate.getFullYear() === nowDate.getFullYear()) {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(tsDate);
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(tsDate);
}

const relativeEs = {
  justNow: "ahora mismo",
  minutesAgo: (n: number) => `hace ${n} min`,
  hoursAgo: (n: number) => `hace ${n} h`,
  yesterdayAt: (time: string) => `Ayer ${time}`,
};

const relativeEn = {
  justNow: "just now",
  minutesAgo: (n: number) => `${n}m ago`,
  hoursAgo: (n: number) => `${n}h ago`,
  yesterdayAt: (time: string) => `Yesterday ${time}`,
};

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
  const dek = Dek.generate();
  const session: Session = {
    anonymous: true,
    accountId,
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
        props.session.dek.clone(),
        EncryptedBlob,
      );
      const replay = await wal.loadForReplay();
      tap(
        `loadForReplay (${replay.walEntries.length} wal)`,
        performance.now(),
      );
      // `loadForReplay` already pulled the device row in the same
      // tx; only fall back to a separate get if an implementation
      // skipped it.
      const device =
        replay.device !== undefined ? replay.device : await wal.getDevice();
      const doc = replay.snapshot ? Doc.load(replay.snapshot) : Doc.empty();
      tap("Doc.load(snapshot)", performance.now());
      // The replay path tags WAL imports as "remote" so the rebuilt
      // UndoManager skips them; replay order is wal_seq ascending,
      // matching the order they were committed locally.
      for (const entry of replay.walEntries) {
        try {
          doc.importWalUpdates(entry.plaintext);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`wal replay failed at seq ${entry.walSeq}:`, e);
        }
      }
      tap("WAL replay done", performance.now());
      props.setBoot({
        doc,
        lastAcked: BigInt(device?.lastAckedOpId ?? 0),
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
    "lastAcked=",
    String(props.boot.lastAcked),
  );
  // Both SyncEngine and the WAL store consume their Dek argument, and
  // the session-level Dek must stay valid across MainApp remounts
  // (anonymous → authed swap remounts this whole tree on the Session
  // key). So clone for each consumer; the original on
  // `props.session.dek` is untouched.
  const engine = new SyncEngine(
    props.boot.doc,
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

  // ---------- WAL: hot path, per commit ----------
  //
  // After every mutation (local or remote) we capture a Loro update
  // covering everything since the previous WAL append, encrypt it, and
  // append a row to IndexedDB. `walVvCursor` advances each time so the
  // next chunk is strictly the new ops. Remote-applied ops also flow
  // through here — including them is wasteful but harmless on replay
  // (CRDT updates are idempotent).
  //
  // Fresh-signup seeding: `Doc.create()` happens in the boot path before
  // this listener is wired, so the seeded built-ins are already in the
  // engine. Start the cursor at empty so the very first capture emits
  // them as `wal_seq = 1` — that gives reload pure-WAL replay (per
  // spec/idb-wal.md "Fresh Account") without needing a special
  // snapshot-at-signup that would otherwise commit a `seq = 0` snapshot
  // and conflict with the visibility-hidden snapshot path.
  let walVvCursor: Uint8Array | null = wal
    ? props.session.freshSignup
      ? new Uint8Array(0)
      : engine.oplogVvBytes()
    : null;
  let walAppendChain: Promise<void> = Promise.resolve();
  const captureAndAppend = (): void => {
    if (!wal || !walVvCursor) return;
    const updates = engine.exportUpdatesAfter(walVvCursor);
    if (updates.length === 0) return;
    walVvCursor = engine.oplogVvBytes();
    const w = wal;
    walAppendChain = walAppendChain
      .then(() => w.appendWal(updates))
      .then(() => {
        if (w.shouldSnapshot()) scheduleSnapshot();
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("wal append failed:", e);
      });
  };

  // Anonymous sessions are local-only by definition — no account on
  // the server to authenticate to. Skip the WebSocket pump entirely;
  // local mutations still flow through the engine for WAL persist.
  let bridge: SyncBridge | null = null;
  if (!props.session.anonymous) {
    bridge = new SyncBridge({
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
      onAppEvents: () => {
        app.drainEvents();
        // Server frame applied → capture remote-imported ops too. Cheap
        // when nothing changed (export returns 0 bytes).
        captureAndAppend();
      },
      onAuthFailed: () => void props.logout(),
    });
    const b = bridge;
    app.setOnFlush(() => {
      captureAndAppend();
      b.pumpOutbox();
    });
    bridge.start();
    onCleanup(() => b.stop());
  } else {
    // Anonymous: still capture local commits for WAL durability.
    app.setOnFlush(() => captureAndAppend());
  }

  // ---------- Snapshot: cold path ----------
  //
  // Triggered when the WAL has accumulated `SNAPSHOT_THRESHOLD` rows
  // since the last committed snapshot, or by a visibility-hidden flush
  // on tab close. We wait for the in-flight WAL chain so the new
  // `snapshot_wal_seq` we record actually covers every appended row.
  let snapshotChain: Promise<void> = Promise.resolve();
  let snapshotPending = false;
  const snapshotNow = async (): Promise<void> => {
    if (!wal) return;
    snapshotPending = false;
    try {
      await walAppendChain;
      const bytes = engine.save();
      const snapshotSeq = wal.highestWalSeq();
      await wal.commitSnapshot(bytes, snapshotSeq);
      if (!props.session.anonymous) {
        await wal.putDevice({
          accountId: props.session.accountId,
          email: props.session.email!,
          // Bundle is served from the same origin as the API; record
          // that origin for completeness even though the cookie is the
          // load-bearing piece of "which server am I talking to".
          serverUrl: window.location.origin,
          deviceId: props.session.deviceId!,
          lastAckedOpId: Number(engine.highestSeenOpId()),
          lastSyncAt: Date.now(),
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("snapshot failed:", e);
    }
  };
  const scheduleSnapshot = (): void => {
    if (snapshotPending) return;
    snapshotPending = true;
    snapshotChain = snapshotChain.then(snapshotNow);
  };

  // ---------- Device config: light writes on each frontier change ----------
  //
  // `lastAckedOpId` advances independently of mutations. Persist it on
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
          email: props.session.email!,
          serverUrl: window.location.origin,
          deviceId: props.session.deviceId!,
          lastAckedOpId: Number(engine.highestSeenOpId()),
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
  if (wal && props.session.freshSignup) {
    captureAndAppend();
  }

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      // Drain WAL appends in flight, then commit a snapshot so the
      // next boot has a fresh base. Best-effort — IDB writes already
      // queued behind `walAppendChain` will land regardless of whether
      // the snapshot fires before the page goes away.
      if (deviceTimer) clearTimeout(deviceTimer);
      void snapshotNow();
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

function Workspace(props: {
  app: DocApp;
  session: Session;
  online: boolean;
  lastSyncAt: number | null;
  logout: () => void;
  onSession: (s: Session) => void;
  // View lives in `MainApp` so device writes can persist it alongside
  // the sync frontier in one debounced put. See `currentView` on
  // `DeviceConfig`.
  view: () => ViewKey;
  setView: (v: ViewKey) => void;
}) {
  const { m } = useAppI18n();
  const app = props.app;
  const state = app.state;
  const view = props.view;
  const setView = props.setView;
  const [dndItems, setDndItems] = createSignal<ItemView[]>([]);
  const [themePref, setThemePref] = createSignal<ThemePreference>(theme.get());
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [findOpen, setFindOpen] = createSignal(false);
  const matchesKbDevice = createKbDeviceSignal();

  // Draft state: a transient ItemView injected into dndItems but not into
  // the store. `insertIndex` is captured at draft-start time so collapse
  // commits at the same slot the user originally clicked from (e.g. after
  // their selection), even if peer ops shift the list around in the
  // meantime. expandedKey is controlled here so we can drive it open on
  // draft start and react when the controller collapses (Escape, click-
  // outside, or any other path).
  const [draft, setDraft] = createSignal<{
    item: ItemView;
    insertIndex: number;
    listId: string;
  } | null>(null);
  const [expandedKey, setExpandedKey] = createSignal<string | null>(null);

  // Touch viewports get taller rows so each item's a comfortable tap
  // target (the 28px desktop default is too tight for a thumb). Dnd's
  // cfg() reads itemHeight reactively via setConfig, so flipping this
  // signal on rotation / resize live-updates the controller.
  const itemsMobileMq = window.matchMedia("(max-width: 768px)");
  const [itemsIsMobile, setItemsIsMobile] = createSignal(itemsMobileMq.matches);
  const onItemsMqChange = (e: MediaQueryListEvent) => setItemsIsMobile(e.matches);
  itemsMobileMq.addEventListener("change", onItemsMqChange);
  onCleanup(() => itemsMobileMq.removeEventListener("change", onItemsMqChange));

  // One selection model per Workspace instance — the Dnd component is
  // re-keyed on view change (so it remounts), but we re-use the selection
  // object so consumers always read from the same handle. Stale block
  // anchors from the previous view's keys would resolve to position 0
  // (giving phantom selection at the top of the new list), so clear when
  // the view switches.
  const selection = new DndSelection();
  createEffect(
    on(
      view,
      () => {
        selection.clear();
        // A draft is scoped to the list it was started in; switching
        // away discards it (no save) and collapses.
        setDraft(null);
        setExpandedKey(null);
      },
      { defer: true },
    ),
  );

  // Linger group for the active list view: the unbroken chain of
  // recently-done items walking back from the latest click. A new
  // Done click within DONE_LINGER_MS of the previous extends the
  // whole chain, so a burst of clicks all leave together at the
  // latest's expiry; a click after a gap starts a fresh chain.
  const lingerChain = createMemo(
    (): { ids: Set<string>; expiry: number } => {
      const v = view();
      if (v.kind !== "list") return { ids: new Set(), expiry: -Infinity };
      const done: ItemView[] = [];
      for (const id of state.itemsOrder) {
        const it = state.itemsById[id];
        if (!it || it.listId !== v.id || isBinned(it) || !isDone(it)) continue;
        done.push(it);
      }
      if (done.length === 0) return { ids: new Set(), expiry: -Infinity };
      done.sort((a, b) => b.doneAt! - a.doneAt!);
      const ids = new Set<string>();
      let prev = done[0].doneAt!;
      for (const it of done) {
        if (prev - it.doneAt! >= DONE_LINGER_MS) break;
        ids.add(it.id);
        prev = it.doneAt!;
      }
      return { ids, expiry: done[0].doneAt! + DONE_LINGER_MS };
    },
  );

  // Self-arms a single timeout for the chain's expiry — fires once
  // when the whole group should flush. Re-arms automatically when a
  // new click extends the chain (lingerChain memo changes).
  const [lingerTick, setLingerTick] = createSignal(0);
  createEffect(() => {
    lingerTick();
    const { expiry } = lingerChain();
    const remaining = expiry - Date.now();
    if (remaining <= 0) return;
    const t = setTimeout(() => setLingerTick((n) => n + 1), remaining);
    onCleanup(() => clearTimeout(t));
  });

  // Per-view item slice. Each `state.itemsById[id]` access is a tracked
  // path on the store proxy, so adds/removes to itemsOrder and field
  // changes on individual items both flow through this memo without
  // either invalidating the other.
  const items = createMemo((): ItemView[] => {
    const v = view();
    const all = state.itemsOrder
      .map((id) => state.itemsById[id])
      .filter((it): it is ItemView => it !== undefined);
    if (v.kind === "list") {
      lingerTick();
      const { ids: lingerIds, expiry } = lingerChain();
      const groupActive = Date.now() < expiry;
      return all.filter(
        (it) =>
          it.listId === v.id &&
          !isBinned(it) &&
          (!isDone(it) || (groupActive && lingerIds.has(it.id))),
      );
    }
    if (v.kind === "done") {
      // Done view excludes binned items: a done-then-binned item lives
      // in the Bin (see context menu — Bin owns the next transition).
      return all
        .filter((it) => isDone(it) && !isBinned(it))
        .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    }
    return all
      .filter(isBinned)
      .sort((a, b) => (b.binnedAt ?? 0) - (a.binnedAt ?? 0));
  });

  const lists = createMemo((): ListView[] =>
    state.listsOrder
      .map((id) => state.listsById[id])
      .filter((l): l is ListView => l !== undefined),
  );

  // Bin badge / visibility in the nav. Independent of `items()` so the
  // count stays accurate while viewing any list — and so an empty Bin
  // can hide the button without disturbing the active-view memo.
  const binCount = createMemo((): number => {
    let n = 0;
    for (const id of state.itemsOrder) {
      const it = state.itemsById[id];
      if (it && isBinned(it)) n++;
    }
    return n;
  });

  // Per-list live-item counts for the nav badge. Single pass over the
  // global items array so adding lists doesn't multiply the work; the
  // memo invalidates whenever any item moves/changes status, which is
  // the same trigger as `items()`. Queue's count always renders;
  // non-Queue lists are gated by the doc-level `showListCounts` flag.
  const liveCountsByList = createMemo((): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const id of state.itemsOrder) {
      const it = state.itemsById[id];
      if (!it || !isInListView(it)) continue;
      counts[it.listId] = (counts[it.listId] ?? 0) + 1;
    }
    return counts;
  });

  const dndRevision = createMemo(() => {
    const v = view();
    return `${v.kind}:${v.kind === "list" ? v.id : "-"}`;
  });

  // Id of the currently-viewed list iff it can be renamed. Both `main`
  // (Home, via the doc-level settings override) and any user-created
  // list qualify; only the done/bin cross-cutting views opt out.
  const editableListId = createMemo(() => {
    const v = view();
    return v.kind === "list" ? v.id : null;
  });

  // Resolved display label for the reserved `main` (Home) list:
  // user override from doc-level settings if present, otherwise the
  // localized built-in label. Centralised here so the nav row, the
  // workspace header, and `viewTitle` agree.
  const homeName = createMemo((): string => {
    const override = state.settings.mainName;
    return override && override.length > 0 ? override : m().nav.home;
  });

  createEffect(() => {
    const next = items();
    const d = draft();
    if (!d) {
      setDndItems(next);
      return;
    }
    const merged = [...next];
    const at = Math.min(Math.max(d.insertIndex, 0), merged.length);
    merged.splice(at, 0, d.item);
    setDndItems(merged);
  });

  const onReorder = (op: DndOp<ItemView>) => {
    if (op.type !== "move") return;
    const v = view();
    if (v.kind !== "list") return;
    const ids = items().map((it) => it.id);
    const movedSet = new Set(op.keys.map(String));
    const movedIds = ids.filter((id) => movedSet.has(id));
    if (movedIds.length === 0) return;

    const remaining = ids.filter((id) => !movedIds.includes(id));
    const insertAt =
      op.beforeKey === null
        ? remaining.length
        : (() => {
            const idx = remaining.indexOf(String(op.beforeKey));
            return idx >= 0 ? idx : remaining.length;
          })();
    const nextIds = [...remaining];
    nextIds.splice(insertAt, 0, ...movedIds);

    const currentIds = [...ids];
    app.withActionBatch(() => {
      for (const [index, id] of nextIds.entries()) {
        if (currentIds[index] !== id) {
          const currentIndex = currentIds.indexOf(id);
          if (currentIndex < 0) continue;
          app.moveItem(id, v.id, index);
          currentIds.splice(currentIndex, 1);
          currentIds.splice(index, 0, id);
        }
      }
    });
  };

  // Start a draft row: pseudo-item just below the topmost selected
  // item (or at the top if nothing is selected). Expanding it via the
  // controlled `expandedKey` flips the row into edit mode through the
  // same path used for existing rows. If a draft is already open, no-op
  // — the natural click-outside collapse on the existing draft will
  // settle it first.
  const startDraft = () => {
    const v = view();
    if (v.kind !== "list") return;
    if (draft() !== null) return;
    const ids = items().map((i) => i.id);
    const top = selection.getSelectionTop();
    let insertIndex = 0;
    if (top !== null) {
      const idx = ids.indexOf(String(top));
      if (idx >= 0) insertIndex = idx + 1;
    }
    const id = `${DRAFT_ID_PREFIX}${crypto.randomUUID()}`;
    const draftItem: ItemView = {
      id,
      listId: v.id,
      text: "",
      notes: "",
      createdAt: Date.now(),
    };
    setDraft({ item: draftItem, insertIndex, listId: v.id });
    setExpandedKey(id);
  };

  // Called by the draft Row from its collapse effect. Empty text → drop;
  // non-empty → real item via addItemAt at the captured slot, then
  // re-anchor selection so the user lands on what they just created.
  // `chain` is true when the user pressed Enter; on a successful save
  // we open a fresh draft below the new item so capture continues. An
  // empty Enter still ends the chain (it falls through to the cancel
  // path below).
  const settleDraft = (text: string, notes: string, chain: boolean) => {
    const d = draft();
    if (!d) return;
    setDraft(null);
    if (!text) {
      // Cancel path. The dnd's applyExpanded(draftId) replaced selection
      // with the draft id; once setDraft(null) drops it from the order,
      // the leftover block's anchor stops resolving and the selection
      // chrome snaps to the first item. Re-anchor on the row immediately
      // above the captured slot (or the slot itself when nothing is above)
      // so cancel lands the user back near where they were.
      const rest = items();
      if (rest.length === 0) {
        selection.clear();
        return;
      }
      const target = rest[Math.max(0, d.insertIndex - 1)];
      selection.selectOnly(target.id);
      return;
    }
    const newId = app.addItemAt(d.listId, text, d.insertIndex);
    // Notes are persisted as a follow-up edit because the draft has no
    // engine record while the user is typing — `editItemNotes` on a
    // draft id would no-op. Skip the call for empty notes (the new
    // item starts with `notes: ""` already).
    if (notes) app.editItemNotes(newId, notes);
    // The store dispatch that adds the new item runs before this
    // microtask, so by then `selection.updateOrder` has already seen
    // the new id and the selection anchor is valid. When chaining,
    // startDraft reads the topmost selection to pick the insert slot,
    // so the selectOnly above must land first — same microtask, same
    // ordering.
    queueMicrotask(() => {
      selection.selectOnly(newId);
      if (chain) startDraft();
    });
  };

  // Paste anywhere in a list view drops the clipboard contents in as items,
  // one per non-empty line. Skip when the paste targets an editable element
  // (add form, row edit, list rename) so normal paste still works there.
  // If any rows are selected, insert immediately after the last-selected one;
  // otherwise append.
  const onPaste = (e: ClipboardEvent) => {
    const v = view();
    if (v.kind !== "list") return;
    const target = e.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    const data = e.clipboardData?.getData("text") ?? "";
    const lines = data
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^-\s+(?:\[[^\]]*\]\s*)?/, ""))
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;
    e.preventDefault();
    const visible = items().map((it) => it.id);
    const selectedHere = selection
      .getSelectedKeys()
      .map((k) => visible.indexOf(String(k)))
      .filter((idx) => idx >= 0);
    const insertAt =
      selectedHere.length === 0 ? visible.length : Math.max(...selectedHere) + 1;
    const ids = app.addItemsAt(v.id, lines, insertAt);
    if (ids.length === 0) return;
    // Wait for the dnd's source to absorb the new ids — see the
    // matching note in onDuplicate.
    queueMicrotask(() => {
      selection.selectOnly(ids[0]);
      if (ids.length > 1) selection.extendActive(ids[ids.length - 1]);
    });
  };
  document.addEventListener("paste", onPaste);
  onCleanup(() => document.removeEventListener("paste", onPaste));

  // Delete / Backspace on the active view: bin live or done items, hard-
  // delete binned ones. Skip when focus is inside an editable surface so
  // the AddForm, row edit, and list rename keep their native behaviour.
  const onDeleteKey = (e: KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const target = e.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    const v = view();
    const visibleIds = items().map((it) => it.id);
    const visibleSet = new Set(visibleIds);
    const ids = selection
      .getSelectedKeys()
      .map(String)
      .filter((id) => visibleSet.has(id));
    if (ids.length === 0) return;
    e.preventDefault();
    const deleteSet = new Set(ids);
    // Pick the survivor to focus next: first surviving id after the
    // bottom-most deleted row, else the new last surviving id.
    let lastIdx = -1;
    for (let i = visibleIds.length - 1; i >= 0; i--) {
      if (deleteSet.has(visibleIds[i])) {
        lastIdx = i;
        break;
      }
    }
    let nextId: string | null = null;
    for (let i = lastIdx + 1; i < visibleIds.length; i++) {
      if (!deleteSet.has(visibleIds[i])) {
        nextId = visibleIds[i];
        break;
      }
    }
    if (nextId === null) {
      for (let i = visibleIds.length - 1; i >= 0; i--) {
        if (!deleteSet.has(visibleIds[i])) {
          nextId = visibleIds[i];
          break;
        }
      }
    }
    if (v.kind === "bin") app.deleteBinnedMany(ids);
    else app.setBinnedMany(ids, true);
    if (nextId === null) {
      selection.clear();
    } else {
      const target = nextId;
      // Wait for the dnd source to absorb the removals before
      // selecting — matches onDuplicate/onPaste.
      queueMicrotask(() => selection.selectOnly(target));
    }
  };
  document.addEventListener("keydown", onDeleteKey);
  onCleanup(() => document.removeEventListener("keydown", onDeleteKey));

  // Duplicate live items as a contiguous block immediately after the
  // bottom-most source row — same shape as paste — rather than each
  // clone sitting under its own original. Shared by Cmd+D and the row
  // context menu's Duplicate action so both behave identically.
  const duplicateBlock = (sourceIds: readonly string[]): void => {
    const v = view();
    if (v.kind !== "list") return;
    const visible = items().map((it) => it.id);
    const sourceSet = new Set(sourceIds);
    const sourcesInOrder: { idx: number; text: string }[] = [];
    visible.forEach((id, idx) => {
      if (!sourceSet.has(id)) return;
      const it = app.getItem(id);
      if (!it || !isInListView(it)) return;
      sourcesInOrder.push({ idx, text: it.text });
    });
    if (sourcesInOrder.length === 0) return;
    const insertAt = sourcesInOrder[sourcesInOrder.length - 1].idx + 1;
    const texts = sourcesInOrder.map((s) => s.text);
    const newIds = app.addItemsAt(v.id, texts, insertAt);
    if (newIds.length === 0) return;
    // Wait for the dnd's source to absorb the new ids — selectOnly on a
    // key the order map doesn't yet know about leaves it visually
    // unselected.
    queueMicrotask(() => {
      selection.selectOnly(newIds[0]);
      if (newIds.length > 1) selection.extendActive(newIds[newIds.length - 1]);
    });
  };

  // Copy items to the clipboard as a markdown-ish checklist (one line
  // each, in visible order, with `[*]` marking done items) so the block
  // round-trips back as items if the user pastes into Airday. A single
  // source additionally appends its notes on the following line when
  // present, since notes only matter when one item is in focus.
  const copyBlock = (sourceIds: readonly string[]): void => {
    const visible = items().map((it) => it.id);
    const sourceSet = new Set(sourceIds);
    const inOrder: ItemView[] = [];
    visible.forEach((id) => {
      if (!sourceSet.has(id)) return;
      const it = app.getItem(id);
      if (it) inOrder.push(it);
    });
    if (inOrder.length === 0) {
      for (const id of sourceIds) {
        const it = app.getItem(id);
        if (it) inOrder.push(it);
      }
    }
    if (inOrder.length === 0) return;
    const lines = inOrder.map(
      (it) => `- [${isDone(it) ? "*" : " "}] ${it.text}`,
    );
    let text = lines.join("\n");
    if (inOrder.length === 1 && inOrder[0].notes) {
      text = `${text}\n${inOrder[0].notes}`;
    }
    void navigator.clipboard.writeText(text);
  };

  // Cmd/Ctrl+D: duplicate the current selection.
  const onDuplicateKey = (e: KeyboardEvent) => {
    if (e.key !== "d" && e.key !== "D") return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    const target = e.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    const ids = selection.getSelectedKeys().map(String);
    if (ids.length === 0) return;
    e.preventDefault();
    duplicateBlock(ids);
  };
  document.addEventListener("keydown", onDuplicateKey);
  onCleanup(() => document.removeEventListener("keydown", onDuplicateKey));

  // Cmd/Ctrl+C: copy the current selection through copyBlock. Skipped
  // when focus is in an editable surface so the browser's native copy
  // still grabs the user's text fragment, and skipped when there's a
  // non-collapsed window selection (the user is copying highlighted
  // text, not rows).
  const onCopyKey = (e: KeyboardEvent) => {
    if (e.key !== "c" && e.key !== "C") return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    const target = e.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) return;
    const ids = selection.getSelectedKeys().map(String);
    if (ids.length === 0) return;
    e.preventDefault();
    copyBlock(ids);
  };
  document.addEventListener("keydown", onCopyKey);
  onCleanup(() => document.removeEventListener("keydown", onCopyKey));

  // Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z (redo). Skipped when focus
  // is in an editable surface so the browser's native text-undo handles
  // mid-typing in inputs/textareas/contenteditable rows. Only swallows
  // the keystroke when the engine actually applied a step — otherwise
  // the OS / browser still gets a shot at it.
  const onUndoRedoKey = (e: KeyboardEvent) => {
    if (e.key !== "z" && e.key !== "Z") return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.altKey) return;
    const target = e.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    const did = e.shiftKey ? app.redo() : app.undo();
    if (did) e.preventDefault();
  };
  document.addEventListener("keydown", onUndoRedoKey);
  onCleanup(() => document.removeEventListener("keydown", onUndoRedoKey));

  // Enter: expand the topmost selected row, or collapse the expanded row
  // (collapse runs the save effect in Row). The expanded-row's
  // contenteditable owns Enter while editing — it dispatches an Escape to
  // drive collapse — so the editable-surface guard below keeps us from
  // double-handling there.
  let dndHandle: DndImperative | null = null;
  const onEnterExpand = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const target = e.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    if (!dndHandle) return;
    if (dndHandle.getExpanded() !== null) {
      e.preventDefault();
      dndHandle.setExpanded(null);
      return;
    }
    const top = selection.getSelectionTop();
    if (top === null) return;
    e.preventDefault();
    dndHandle.setExpanded(top);
  };
  document.addEventListener("keydown", onEnterExpand);
  onCleanup(() => document.removeEventListener("keydown", onEnterExpand));

  // Space: shortcut for the Add button — start a draft below the topmost
  // selection, same as a click. startDraft already gates on list view and
  // an open draft, so the handler just guards modifiers and editable focus.
  const onSpaceAdd = (e: KeyboardEvent) => {
    if (e.key !== " ") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const target = e.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    if (view().kind !== "list") return;
    if (draft() !== null) return;
    e.preventDefault();
    startDraft();
  };
  document.addEventListener("keydown", onSpaceAdd);
  onCleanup(() => document.removeEventListener("keydown", onSpaceAdd));

  // Drag items into a list nav button to move them to that list as the
  // first items, or onto Bin to status-bin them. Discriminate from the
  // nav's own list-reorder drag by checking detail.items[0] for an
  // item-shaped record (`listId` is present on ItemView, absent on
  // ListView). Bubbling + composed means a single document-level
  // listener catches both Dnd instances.
  type DropTarget =
    | { kind: "list"; el: HTMLElement; listId: string }
    | { kind: "bin"; el: HTMLElement };
  const findDropTarget = (x: number, y: number): DropTarget | null => {
    const el = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-drop-list-id], [data-drop-bin]");
    if (!el) return null;
    if (el.dataset.dropListId !== undefined) {
      return { kind: "list", el, listId: el.dataset.dropListId };
    }
    return { kind: "bin", el };
  };
  const clearDropHighlight = () => {
    document
      .querySelectorAll<HTMLElement>("[data-drop-active]")
      .forEach((el) => delete el.dataset.dropActive);
  };
  const isItemDrag = (items: readonly unknown[]): boolean =>
    items.length > 0 &&
    typeof items[0] === "object" &&
    items[0] !== null &&
    "listId" in items[0];

  const onDndDragMove = (e: Event) => {
    const ce = e as CustomEvent<DndDragEventDetail>;
    if (!isItemDrag(ce.detail.items)) return;
    clearDropHighlight();
    const target = findDropTarget(ce.detail.x, ce.detail.y);
    if (target) target.el.dataset.dropActive = "";
  };
  const onDndDragEnd = (e: Event) => {
    const ce = e as CustomEvent<DndDragEventDetail>;
    clearDropHighlight();
    if (!isItemDrag(ce.detail.items)) return;
    const target = findDropTarget(ce.detail.x, ce.detail.y);
    if (!target) return;
    ce.preventDefault();
    const draggedKeys = new Set(ce.detail.keys.map(String));
    // Sort by current global order so multi-select drops preserve the
    // user's visible ordering rather than landing in selection order.
    const idsInOrder = state.itemsOrder.filter((id) => draggedKeys.has(id));
    if (target.kind === "bin") {
      const toBin = idsInOrder.filter((id) => {
        const it = app.getItem(id);
        return it !== undefined && !isBinned(it);
      });
      if (toBin.length === 0) return;
      app.setBinnedMany(toBin, true);
      selection.clear();
      return;
    }
    const toUndone = idsInOrder.filter((id) => {
      const it = app.getItem(id);
      return it !== undefined && isDone(it);
    });
    const toUnbin = idsInOrder.filter((id) => {
      const it = app.getItem(id);
      return it !== undefined && isBinned(it);
    });
    app.withActionBatch(() => {
      if (toUndone.length > 0) app.setDoneMany(toUndone, false);
      if (toUnbin.length > 0) app.setBinnedMany(toUnbin, false);
      for (const [i, id] of idsInOrder.entries()) {
        app.moveItem(id, target.listId, i);
      }
    });
    // When dragging out of the current list, the rows are no longer
    // visible here — leaving them "selected" means a phantom block
    // anchor lingers. Same-list drops keep selection so the user can
    // continue acting on the rows they just rearranged.
    const v = view();
    const sameList = v.kind === "list" && v.id === target.listId;
    if (!sameList) selection.clear();
  };
  document.addEventListener("primavera-dnd-dragmove", onDndDragMove);
  document.addEventListener("primavera-dnd-dragend", onDndDragEnd);
  onCleanup(() => {
    document.removeEventListener("primavera-dnd-dragmove", onDndDragMove);
    document.removeEventListener("primavera-dnd-dragend", onDndDragEnd);
  });

  // Selecting a palette result: jump to the view that contains it and
  // re-anchor the dnd selection on the row. Lists go straight to that
  // list. Items pick the view based on their status — binned items live
  // in the Bin, done-only items in Done, otherwise their list. The
  // selection + scroll bounce is deferred past the view-change effect
  // (which clears selection) and past the keyed Dnd remount, so the
  // new controller's source has the row's index when scrollToKey lands.
  const onFindSelect = (r: SearchResult) => {
    if (r.kind === "list") {
      setView({ kind: "list", id: r.id });
      return;
    }
    const target: ViewKey =
      r.status === "binned"
        ? { kind: "bin" }
        : r.status === "done"
          ? { kind: "done" }
          : { kind: "list", id: r.listId || "main" };
    setView(target);
    setTimeout(() => {
      selection.selectOnly(r.id);
      dndHandle?.scrollToKey(r.id);
    }, 0);
  };

  // While a row is expanded: right-click inside it → native browser menu;
  // right-click anywhere else → noop. Capture-phase so we run before
  // Kobalte's ContextMenu trigger sees the event.
  const onContextMenu = (e: MouseEvent) => {
    const expanded = document.querySelector<HTMLElement>('.row[data-expanded=""]');
    if (!expanded) return;
    if (expanded.contains(e.target as Node)) {
      e.stopPropagation();
    } else {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener("contextmenu", onContextMenu, true);
  onCleanup(() => document.removeEventListener("contextmenu", onContextMenu, true));

  // Mobile drawer: at narrow viewports the nav and main panes both
  // fill the viewport and slide together as one unit (push layout —
  // see styles.css). `navOpen` is the only state; the FAB caret opens
  // it, tapping a list / Escape closes it.
  const mobileMq = window.matchMedia("(max-width: 768px)");
  const [isMobile, setIsMobile] = createSignal(mobileMq.matches);
  const onMqChange = (e: MediaQueryListEvent) => {
    setIsMobile(e.matches);
    // Leaving mobile width while open would leave the drawer stuck
    // open behind the now-static layout. Reset on every transition.
    if (!e.matches) setNavOpen(false);
  };
  mobileMq.addEventListener("change", onMqChange);
  onCleanup(() => mobileMq.removeEventListener("change", onMqChange));

  const [navOpen, setNavOpen] = createSignal(false);

  // Escape closes the open drawer. Scoped to navOpen=true so we don't
  // contend with FindPalette / Settings / row-expansion escape handlers
  // when the drawer isn't even visible.
  createEffect(() => {
    if (!navOpen()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setNavOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    onCleanup(() => document.removeEventListener("keydown", onKey, true));
  });

  return (
    <div
      class="app"
      classList={{
        "nav-open": navOpen(),
      }}
    >
      <Nav
        app={app}
        lists={lists()}
        binCount={binCount()}
        liveCountsByList={liveCountsByList()}
        homeName={homeName()}
        showListCounts={state.settings.showListCounts}
        view={view()}
        setView={(v) => {
          setView(v);
          // Tapping a nav item navigates and dismisses the drawer in
          // one motion — desktop layout ignores navOpen so this is a
          // no-op there.
          if (isMobile()) setNavOpen(false);
          // Move keyboard focus to the items listbox once Solid has
          // settled the new view — keyboard users land ready to arrow /
          // Enter-to-expand / Space-to-add, mouse users get the same
          // priming so a follow-up arrow key Just Works. rAF defers past
          // the <Show keyed> remount when the view's container changes.
          //
          // Skip the steal if the user has by now started editing
          // something — a double-click on a nav label fires two clicks
          // (queueing two rAFs) *then* dblclick → startEdit, which
          // focuses the contenteditable via a microtask. Microtasks
          // drain before the next rAF, so without this guard the
          // pending rAF would yank focus right back out of rename mode.
          requestAnimationFrame(() => {
            const ae = document.activeElement;
            if (
              ae instanceof HTMLElement &&
              (ae.isContentEditable ||
                ae.tagName === "INPUT" ||
                ae.tagName === "TEXTAREA")
            ) {
              return;
            }
            dndHandle?.focus();
          });
        }}
        session={props.session}
        online={props.online}
        lastSyncAt={props.lastSyncAt}
        logout={props.logout}
        onOpenSettings={() => setSettingsOpen(true)}
        onSession={props.onSession}
      />
      <FindPalette
        app={app}
        open={findOpen()}
        onOpenChange={setFindOpen}
        onSelect={(r) => onFindSelect(r)}
      />
      <Settings
        open={settingsOpen()}
        onOpenChange={setSettingsOpen}
        themePref={themePref()}
        onThemeChange={(pref) => {
          setThemePref(pref);
          theme.set(pref);
        }}
        session={props.session}
        logout={props.logout}
      />
      <main class="main">
        <header class="main-header">
          {/* Title group: hamburger sits flush against the title so
              both move as a unit at the left edge of the header. The
              .main-header flex container's space-between then keeps
              the action buttons on the right regardless of group
              width. */}
          <div class="main-header-title">
            <button
              type="button"
              class="nav-toggle"
              aria-label={m().common.menu}
              aria-expanded={navOpen()}
              onClick={() => setNavOpen((o) => !o)}
              innerHTML={menuSvg}
            />
            <h1>
            <Show
              keyed
              when={editableListId()}
              fallback={viewTitle(view(), lists(), homeName(), m())}
            >
              {(listId) => (
                <EditableNavLabel
                  class="editable-title"
                  name={
                    listId === "main"
                      ? homeName()
                      : (lists().find((l) => l.id === listId)?.name ?? listId)
                  }
                  onSave={(name) => {
                    // Home's name lives on the doc-level settings map,
                    // not as a `ListMeta` row — route to the right
                    // mutation so the override survives sync. Empty
                    // input clears the override (falls back to default).
                    if (listId === "main") app.setMainName(name);
                    else app.renameList(listId, name);
                  }}
                />
              )}
            </Show>
          </h1>
          </div>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <Show
              when={
                view().kind === "bin" &&
                items().length > 0
              }
            >
              <button
                type="button"
                class="add-button"
                onClick={() => {
                  // Native confirm() is the cheapest "are you sure?" we
                  // can offer; emptying the bin is destructive (items
                  // are unrecoverable after this) so a y/n gate is
                  // worth the dialog. No custom modal needed.
                  if (window.confirm(m().workspace.emptyBinConfirm)) {
                    app.emptyBin();
                  }
                }}
              >
                <span class="add-button-icon" innerHTML={trashSvg} />
                <span>{m().workspace.emptyBin}</span>
              </button>
            </Show>
            <Show when={view().kind === "list"}>
              <button
                type="button"
                class="add-button"
                onClick={(e) => {
                  // The dnd controller has a document-level click listener
                  // that collapses any expansion when a click lands outside
                  // the expanded row. The Add button is outside the dnd, so
                  // this same click would immediately collapse the draft we
                  // just opened. stopImmediatePropagation halts further
                  // document-level listeners (Solid's delegate runs first
                  // since it registers eagerly during render; the dnd's
                  // listener registers later in onMount).
                  e.stopImmediatePropagation();
                  startDraft();
                }}
                disabled={draft() !== null}
              >
                <span class="add-button-icon" innerHTML={plusSvg} />
                <span>{m().common.add}</span>
              </button>
            </Show>
          </div>
        </header>
        <Show
          when={dndItems().length > 0}
          fallback={
            <div class="dnd-host empty">
              {view().kind === "list" && matchesKbDevice()
                ? m().workspace.createWithSpace
                : m().workspace.emptyState}
            </div>
          }
        >
          <Show keyed when={dndRevision()}>
            <Dnd
              class="dnd-host"
              ref={(h) => (dndHandle = h)}
              items={dndItems()}
              setItems={setDndItems}
              getKey={(it) => it.id}
              selection={selection}
              expandedKey={expandedKey()}
              onExpandedChange={(k) =>
                setExpandedKey(k == null ? null : String(k))
              }
              itemHeight={itemsIsMobile() ? 40 : 28}
              expandable
              clearOnClickOutside
              fillHeight
              reorder={view().kind === "list"}
              onReorder={onReorder}
            >
              {(item, expanded) => (
                <Row
                  item={item}
                  expanded={expanded}
                  app={app}
                  selection={selection}
                  viewKind={view().kind}
                  duplicateBlock={duplicateBlock}
                  copyBlock={copyBlock}
                  onDraftSettle={settleDraft}
                />
              )}
            </Dnd>
          </Show>
        </Show>
        {/* Mobile-only floating action buttons. Position-fixed inside
            .main, but .app's mobile transform reparents the containing
            block onto .app — so right:16px anchors to the main column's
            right edge and left:calc(100vw + 16px) to its left edge.
            That binding also makes the FABs slide off with main when
            the drawer opens, which is exactly the visual we want. */}
        <button
          type="button"
          class="fab fab-back"
          aria-label={m().common.menu}
          onClick={() => setNavOpen(true)}
          innerHTML={caretLeftSvg}
        />
        <Show when={view().kind === "list"}>
          <button
            type="button"
            class="fab fab-add"
            aria-label={m().common.add}
            disabled={draft() !== null}
            onClick={(e) => {
              // See header Add button: stop the dnd's document-level
              // collapse handler from immediately closing the new draft.
              e.stopImmediatePropagation();
              startDraft();
            }}
            innerHTML={plusSvg}
          />
        </Show>
      </main>
    </div>
  );
}

function CloudOffIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="external-icon"
      aria-hidden="true"
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

/** Click-to-open popover anchored to the cloud icon. Shows rolled-up
 *  connection/sync status, last-synced relative time, op id,
 *  fingerprint, and items+lists counts. Periodic ticker only runs
 *  while the popover is open. */
function ConnectionStatusPopover(props: {
  app: DocApp;
  online: boolean;
  lastSyncAt: number | null;
}) {
  const { m, locale } = useAppI18n();
  const [open, setOpen] = createSignal(false);
  // Local seconds-resolution clock — only ticks while the popover is
  // visible so we don't spend a 5s interval forever just to drive a
  // string the user can't see. Falls back to a one-shot read when
  // closed (the sub-minute values won't refresh, but the popover
  // re-opens with fresh values anyway).
  const [tickNow, setTickNow] = createSignal(Date.now());
  createEffect(() => {
    if (!open()) return;
    setTickNow(Date.now());
    const id = setInterval(() => setTickNow(Date.now()), 5_000);
    onCleanup(() => clearInterval(id));
  });

  // Engine-derived state. `app.version()` bumps on every dispatched
  // event, so reading it here re-runs these computations exactly when
  // the underlying numbers can change. Cheap reads — engine just
  // forwards into the doc.
  const pending = (): boolean => {
    props.app.version();
    return props.app.engine.hasPendingOps();
  };
  const opIdLabel = (): string => {
    props.app.version();
    return String(props.app.engine.highestSeenOpId());
  };
  const fingerprintHex = (): string => {
    props.app.version();
    const buf = props.app.engine.fingerprint();
    // Full 64-char hex; the popover row CSS-truncates with
    // text-overflow so the visible width tracks the popover, while
    // copy-paste yields the entire hash.
    let s = "";
    for (let i = 0; i < buf.length; i++) {
      s += buf[i].toString(16).padStart(2, "0");
    }
    return s;
  };
  const itemsCount = (): number => props.app.state.itemsOrder.length;
  const listsCount = (): number => props.app.state.listsOrder.length;

  const sinceLabel = (): string | null => {
    const ts = props.lastSyncAt;
    if (!ts) return null;
    const now = tickNow();
    const diff = now - ts;
    const r = m().relative;
    if (diff < 5_000) return m().nav.lastSynced(r.justNow);
    if (diff < 60_000) {
      return m().nav.lastSynced(r.secondsAgo(Math.floor(diff / 1000)));
    }
    // ≥ 1 min: defer to the shared formatter for minutes/hours/days.
    return m().nav.lastSynced(formatRelative(ts, now, locale()));
  };

  return (
    <Popover open={open()} onOpenChange={setOpen} placement="top-start" gutter={6}>
      <Popover.Trigger
        class="connection-indicator"
        aria-label={props.online ? m().nav.connected : m().nav.disconnected}
      >
        <Show when={props.online} fallback={<CloudOffIcon />}>
          <CloudIcon />
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="status-popover">
          <div class="status-line">
            <span
              class="status-dot"
              data-state={
                !props.online ? "offline" : pending() ? "pending" : "synced"
              }
              aria-hidden="true"
            />
            <span>
              {!props.online
                ? m().nav.disconnected
                : pending()
                  ? m().nav.pendingChanges
                  : m().nav.allSynced}
            </span>
          </div>
          <Show when={sinceLabel()}>
            {(label) => <div class="status-line status-muted">{label()}</div>}
          </Show>
          <div class="status-line status-muted">{m().nav.opLabel(opIdLabel())}</div>
          <div class="status-fingerprint status-muted status-mono">
            {fingerprintHex()}
          </div>
          <div class="status-line status-muted">
            {m().nav.itemsListsCount(itemsCount(), listsCount())}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

function viewTitle(
  v: ViewKey,
  lists: { id: string; name: string }[],
  homeName: string,
  m: ReturnType<typeof useAppI18n>["m"] extends () => infer T ? T : never,
): string {
  if (v.kind === "list") {
    // `homeName` already resolves the user override → localized default
    // chain (see `App.homeName`); pass through verbatim.
    if (v.id === "main") return homeName;
    return lists.find((l) => l.id === v.id)?.name ?? v.id;
  }
  if (v.kind === "done") return m.nav.done;
  return m.nav.bin;
}

function Nav(props: {
  app: DocApp;
  lists: { id: string; name: string }[];
  binCount: number;
  /** Live-item count per list id. Queue's row always renders a badge
   *  (showing "-" when zero); non-Queue rows render theirs only when
   *  `showListCounts` is true, again with "-" for zero. */
  liveCountsByList: Record<string, number>;
  /** Resolved Queue label — user override from doc-level settings if
   *  present, otherwise the localized built-in label. */
  homeName: string;
  /** Doc-level settings flag; when true, render the live-item count
   *  badge beside each non-Queue list in the nav (showing "-" when the
   *  list is empty). Queue's badge is always shown regardless. */
  showListCounts: boolean;
  view: ViewKey;
  setView: (v: ViewKey) => void;
  session: Session;
  online: boolean;
  lastSyncAt: number | null;
  logout: () => void;
  onOpenSettings: () => void;
  onSession: (s: Session) => void;
}) {
  const { m } = useAppI18n();
  const [adding, setAdding] = createSignal(false);
  // Auto-prompt anonymous users on first mount; closing dismisses for
  // the rest of the session. Becoming authed unmounts the trigger via
  // the <Show> below, so a later logout (which mints a fresh anonymous
  // session) will re-open it on the next mount.
  const [authOpen, setAuthOpen] = createSignal(props.session.anonymous);
  const handleSession = (s: Session) => {
    setAuthOpen(false);
    props.onSession(s);
  };
  const [name, setName] = createSignal("");
  const submit = (e: Event) => {
    e.preventDefault();
    const t = name().trim();
    if (!t) return;
    const id = props.app.addList(t);
    setName("");
    setAdding(false);
    props.setView({ kind: "list", id });
  };
  // `main` is a reserved id with no MovableList entry — clients
  // render it as a static nav button, so the dnd source is just
  // `props.lists` directly.
  type NavList = { id: string; name: string };
  const [dndLists, setDndLists] = createSignal<NavList[]>([]);
  createEffect(() => setDndLists(props.lists));

  // Match the items list's mobile bump so the drawer's tap targets feel
  // consistent with the main view.
  const navMobileMq = window.matchMedia("(max-width: 768px)");
  const [navIsMobile, setNavIsMobile] = createSignal(navMobileMq.matches);
  const onNavMqChange = (e: MediaQueryListEvent) => setNavIsMobile(e.matches);
  navMobileMq.addEventListener("change", onNavMqChange);
  onCleanup(() => navMobileMq.removeEventListener("change", onNavMqChange));

  const navSelection = new DndSelection();
  const onNavItemClick = (e: MouseEvent, id: string) => {
    const modKey = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      ? e.metaKey
      : e.ctrlKey;
    if (e.shiftKey || modKey) return;
    props.setView({ kind: "list", id });
  };
  // Enter on a keyboard-focused user list opens it. The Dnd listbox owns
  // arrow-key navigation and updates navSelection's top key as the user
  // moves; we just translate that into a setView. stopPropagation keeps the
  // document-level onEnterExpand (App.tsx:1273) from also firing and
  // expanding whatever's selected in the main list.
  const onNavKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const target = e.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    const top = navSelection.getSelectionTop();
    if (top === null) return;
    e.preventDefault();
    e.stopPropagation();
    props.setView({ kind: "list", id: String(top) });
  };
  const selectedNavIds = (id: string): string[] =>
    navSelection.isSelected(id) ? navSelection.getSelectedKeys().map(String) : [id];

  // Reactive read-throughs of the engine's undo state. `app.version`
  // bumps on every dispatched event (local mutation, undo/redo, remote
  // import), which is exactly when undo availability can change.
  const canUndo = (): boolean => {
    props.app.version();
    return props.app.canUndo();
  };
  const canRedo = (): boolean => {
    props.app.version();
    return props.app.canRedo();
  };

  // Trigger a browser download for an in-memory blob. Anchor + revoke
  // is the only cross-browser path; FileSystem Access API isn't on
  // Safari yet.
  const triggerDownload = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // "Export → Backup": full plaintext Loro snapshot. Same bytes the
  // engine would seal for the server, but unencrypted — anyone holding
  // the file can replay the whole doc into a fresh `Doc::load`-style
  // import. Date-stamped filename so repeat exports don't collide in
  // the Downloads folder.
  const downloadBackup = (): void => {
    try {
      const bytes = props.app.engine.exportSnapshot();
      // Copy into a fresh ArrayBuffer — wasm-bindgen returns a view
      // over the wasm linear memory, and Blob can capture-by-reference
      // in some engines, leaving the download with a stale pointer
      // once wasm reuses the bytes.
      const buf = new Uint8Array(bytes.byteLength);
      buf.set(bytes);
      const blob = new Blob([buf], { type: "application/octet-stream" });
      const stamp = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `airday-${stamp}.bin`);
    } catch (err) {
      console.error("export backup failed:", err);
      alert(m().nav.exportFailed);
    }
  };

  // "Export → JSON": pretty-printed semantic dump (lists + items).
  // Companion to the binary backup — readable in any editor, but lossy:
  // CRDT history, ordering metadata, and undo-stack info aren't here.
  const downloadJson = (): void => {
    try {
      const json = props.app.engine.exportJson();
      const blob = new Blob([json], { type: "application/json" });
      const stamp = new Date().toISOString().slice(0, 10);
      triggerDownload(blob, `airday-${stamp}.json`);
    } catch (err) {
      console.error("export json failed:", err);
      alert(m().nav.exportFailed);
    }
  };

  const onReorder = (op: DndOp<NavList>) => {
    if (op.type !== "move") return;
    const ids = props.lists.map((l) => l.id);
    const movedIds = op.keys.map(String).filter((id) => ids.includes(id));
    if (movedIds.length === 0) return;
    const remaining = ids.filter((id) => !movedIds.includes(id));
    const insertAt =
      op.beforeKey === null
        ? remaining.length
        : (() => {
            const idx = remaining.indexOf(String(op.beforeKey));
            return idx >= 0 ? idx : remaining.length;
          })();
    const nextIds = [...remaining];
    nextIds.splice(insertAt, 0, ...movedIds);
    const currentIds = [...ids];
    for (const [index, id] of nextIds.entries()) {
      if (currentIds[index] !== id) {
        const currentIndex = currentIds.indexOf(id);
        if (currentIndex < 0) continue;
        props.app.moveList(id, index);
        currentIds.splice(currentIndex, 1);
        currentIds.splice(index, 0, id);
      }
    }
  };
  // Captured by the Home ContextMenu's Rename item — same trick as the
  // user-list rows further down so the menu can drive rename mode the
  // same way a double-click on the label does.
  let startHomeRename: (() => void) | undefined;
  return (
    <nav class="nav" onKeyDown={onNavKeyDown}>
      <div class="nav-group">
        <ContextMenu>
          <ContextMenu.Trigger
            as="button"
            type="button"
            class="nav-item"
            data-active={
              props.view.kind === "list" && props.view.id === "main"
                ? ""
                : undefined
            }
            data-drop-list-id="main"
            onClick={() => props.setView({ kind: "list", id: "main" })}
          >
            <span class="nav-item-icon" innerHTML={arrowRightSvg} />
            <EditableNavLabel
              name={props.homeName}
              onSave={(name) => props.app.setMainName(name)}
              registerStart={(fn) => (startHomeRename = fn)}
            />
            <span class="nav-item-count">
              {(props.liveCountsByList["main"] ?? 0) > 0
                ? props.liveCountsByList["main"]
                : "-"}
            </span>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content class="context-menu-content">
              <ContextMenu.Item
                class="context-menu-item"
                onSelect={() => {
                  // Defer past the menu close + focus-restore (Kobalte
                  // returns focus to the trigger on dismiss), matching
                  // the user-list Rename pathway.
                  requestAnimationFrame(() => startHomeRename?.());
                }}
              >
                {m().nav.renameList}
              </ContextMenu.Item>
              <ContextMenu.Item
                class="context-menu-item"
                onSelect={() => {
                  props.app.setShowListCounts(!props.showListCounts);
                }}
              >
                {props.showListCounts
                  ? m().nav.hideListCounts
                  : m().nav.showListCounts}
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu>
        <button
          type="button"
          class="nav-item"
          data-active={props.view.kind === "done" ? "" : undefined}
          onClick={() => props.setView({ kind: "done" })}
        >
          <span class="nav-item-icon" innerHTML={checkSvg} />
          {m().nav.done}
        </button>
        <Show when={props.binCount > 0}>
          <ContextMenu>
            <ContextMenu.Trigger
              as="button"
              type="button"
              class="nav-item"
              data-active={props.view.kind === "bin" ? "" : undefined}
              data-drop-bin=""
              onClick={() => props.setView({ kind: "bin" })}
            >
              <span class="nav-item-icon" innerHTML={crumpledPaperSvg} />
              {m().nav.bin}
              <span class="nav-item-count">{props.binCount}</span>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content class="context-menu-content">
                <ContextMenu.Item
                  class="context-menu-item"
                  onSelect={() => {
                    // Mirror the header button's destructive-action gate
                    // (App.tsx:1503) — same confirm string, same call.
                    if (window.confirm(m().workspace.emptyBinConfirm)) {
                      props.app.emptyBin();
                    }
                  }}
                >
                  {m().workspace.emptyBin}
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu>
        </Show>
      </div>
      <div class="nav-group">
        <Show when={props.lists.length > 0}>
          <Dnd
            items={dndLists()}
            setItems={setDndLists}
            getKey={(l) => l.id}
            itemHeight={navIsMobile() ? 40 : 28}
            multi
            arrowNavigate={false}
            clearOnClickOutside
            selection={navSelection}
            onReorder={onReorder}
          >
            {(l) => {
              // Captured by the Rename ContextMenu.Item below. The
              // EditableNavLabel hands us its startEdit on mount so the
              // context menu can drive rename mode the same way a
              // double-click does.
              let startRename: (() => void) | undefined;
              const selectedIds = (): string[] => selectedNavIds(l().id);
              const isMultiMenu = (): boolean => selectedIds().length > 1;
              const toggleShowListCounts = (): void => {
                props.app.setShowListCounts(!props.showListCounts);
              };
              return (
                <ContextMenu
                  onOpenChange={(open) => {
                    if (open && !navSelection.isSelected(l().id)) {
                      navSelection.selectOnly(l().id);
                    }
                  }}
                >
                  <ContextMenu.Trigger
                    as="button"
                    type="button"
                    class="nav-item"
                    data-active={
                      props.view.kind === "list" && props.view.id === l().id
                        ? ""
                        : undefined
                    }
                    data-drop-list-id={l().id}
                    onClick={(e) => onNavItemClick(e, l().id)}
                  >
                    <EditableNavLabel
                      name={l().name}
                      onSave={(name) => props.app.renameList(l().id, name)}
                      registerStart={(fn) => (startRename = fn)}
                    />
                    <Show when={props.showListCounts}>
                      <span class="nav-item-count">
                        {(props.liveCountsByList[l().id] ?? 0) > 0
                          ? props.liveCountsByList[l().id]
                          : "-"}
                      </span>
                    </Show>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Content class="context-menu-content">
                      <Show
                        when={!isMultiMenu()}
                        fallback={
                          <ContextMenu.Item
                            class="context-menu-item"
                            onSelect={toggleShowListCounts}
                          >
                            {props.showListCounts
                              ? m().nav.hideListCounts
                              : m().nav.showListCounts}
                          </ContextMenu.Item>
                        }
                      >
                        <ContextMenu.Item
                          class="context-menu-item"
                          onSelect={() => {
                            // Defer past the menu's close + focus-restore
                            // (Kobalte returns focus to the trigger on
                            // dismiss); rAF ensures our caret-placement
                            // microtask wins the race.
                            requestAnimationFrame(() => startRename?.());
                          }}
                        >
                          {m().nav.renameList}
                        </ContextMenu.Item>
                        <ContextMenu.Item
                          class="context-menu-item"
                          onSelect={toggleShowListCounts}
                        >
                          {props.showListCounts
                            ? m().nav.hideListCounts
                            : m().nav.showListCounts}
                        </ContextMenu.Item>
                        <ContextMenu.Item
                          class="context-menu-item"
                          onSelect={() => {
                            const id = l().id;
                            if (props.view.kind === "list" && props.view.id === id) {
                              props.setView({ kind: "list", id: "main" });
                            }
                            props.app.deleteList(id);
                          }}
                        >
                          {m().nav.deleteList}
                        </ContextMenu.Item>
                      </Show>
                    </ContextMenu.Content>
                  </ContextMenu.Portal>
                </ContextMenu>
              );
            }}
          </Dnd>
        </Show>
        <Show
          when={adding()}
          fallback={
            <button type="button" class="nav-item" onClick={() => setAdding(true)}>
              {m().nav.newList}
            </button>
          }
        >
          <NewListForm
            name={name()}
            setName={setName}
            onSubmit={submit}
            onDismiss={() => setAdding(false)}
          />
        </Show>
      </div>
      <div class="nav-footer">
        <Show when={props.session.anonymous}>
          <Popover open={authOpen()} onOpenChange={setAuthOpen}>
            <Popover.Trigger class="signin-button">{m().auth.signIn}</Popover.Trigger>
            <Popover.Portal>
              <Popover.Content class="auth-popover">
                <AuthForm onSession={handleSession} />
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        </Show>
        <Show when={!props.session.anonymous}>
          <ConnectionStatusPopover
            app={props.app}
            online={props.online}
            lastSyncAt={props.lastSyncAt}
          />
        </Show>
        <DropdownMenu>
          <DropdownMenu.Trigger
            class="nav-menu-trigger"
            aria-label={m().common.menu}
            innerHTML={dotsVerticalSvg}
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="dropdown-menu-content">
              <DropdownMenu.Item
                class="dropdown-menu-item"
                disabled={!canUndo()}
                onSelect={() => {
                  props.app.undo();
                }}
              >
                <span>{m().nav.undo}</span>
                <kbd class="menu-shortcut">⌘Z</kbd>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="dropdown-menu-item"
                disabled={!canRedo()}
                onSelect={() => {
                  props.app.redo();
                }}
              >
                <span>{m().nav.redo}</span>
                <kbd class="menu-shortcut">⌘⇧Z</kbd>
              </DropdownMenu.Item>
              <DropdownMenu.Separator class="dropdown-menu-separator" />
              <DropdownMenu.Sub overlap gutter={4} shift={-4}>
                <DropdownMenu.SubTrigger class="dropdown-menu-item dropdown-menu-subtrigger">
                  <span>{m().nav.export}</span>
                  <span class="dropdown-menu-chevron" aria-hidden="true">
                    ›
                  </span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent class="dropdown-menu-content">
                    <DropdownMenu.Item
                      class="dropdown-menu-item"
                      onSelect={() => downloadBackup()}
                    >
                      {m().nav.exportBackup}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      class="dropdown-menu-item"
                      onSelect={() => downloadJson()}
                    >
                      {m().nav.exportJson}
                    </DropdownMenu.Item>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Item
                class="dropdown-menu-item"
                onSelect={() => props.onOpenSettings()}
              >
                {m().nav.settings}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="dropdown-menu-item"
                as="a"
                href="https://air.day/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {m().nav.website}
                <ExternalIcon />
              </DropdownMenu.Item>
              <Show when={!props.session.anonymous}>
                <DropdownMenu.Item
                  class="dropdown-menu-item"
                  onSelect={() => props.logout()}
                >
                  {m().nav.logOut}
                </DropdownMenu.Item>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </nav>
  );
}

function NewListForm(props: {
  name: string;
  setName: (v: string) => void;
  onSubmit: (e: Event) => void;
  onDismiss: () => void;
}) {
  const { m } = useAppI18n();
  let inputRef!: HTMLInputElement;
  onMount(() => inputRef.focus());
  return (
    <form onSubmit={props.onSubmit}>
      <input
        ref={inputRef}
        class="nav-item nav-item-input"
        type="text"
        placeholder={m().nav.newList}
        value={props.name}
        onInput={(e) => props.setName(e.currentTarget.value)}
        onBlur={() => {
          if (!props.name.trim()) props.onDismiss();
        }}
      />
    </form>
  );
}

function EditableNavLabel(props: {
  name: string;
  onSave: (name: string) => void;
  class?: string;
  /** Called once on mount with a function the parent can invoke to enter
   *  rename mode (e.g. from a context-menu item). */
  registerStart?: (fn: () => void) => void;
}) {
  let ref!: HTMLSpanElement;
  const [editing, setEditing] = createSignal(false);

  // While not editing, the span's text mirrors the model. While editing
  // we leave the DOM alone so the user's in-flight edits aren't clobbered
  // by reactive updates (including ones from peer renames).
  createEffect(() => {
    if (!editing()) ref.textContent = props.name;
  });

  // Focus + select-all whenever editing flips on, regardless of whether
  // the trigger was a double-click or an external caller (context menu).
  // Microtask defers until contentEditable=true has been applied.
  createEffect(() => {
    if (!editing()) return;
    queueMicrotask(() => {
      ref.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ref);
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  });

  const startEdit = (e?: Event) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (editing()) return;
    setEditing(true);
  };

  onMount(() => {
    props.registerStart?.(() => startEdit());
  });

  const save = () => {
    if (!editing()) return;
    const next = (ref.textContent ?? "").trim();
    setEditing(false);
    if (next !== props.name) props.onSave(next);
    else ref.textContent = props.name;
  };

  const cancel = () => {
    if (!editing()) return;
    setEditing(false);
    ref.textContent = props.name;
  };

  return (
    <span
      ref={ref}
      class={props.class ?? "nav-item-label"}
      contentEditable={editing()}
      onDblClick={startEdit}
      on:keydown={(e) => {
        // Native (non-delegated) so the bubble order is span → nav dnd
        // listbox; Solid's delegated `onKeyDown` would fire at document
        // level *after* the listbox's bubble handler, so Cmd+A would hit
        // the dnd's select-all before we could stop it. Same pattern as
        // the row-text editor below.
        if (!editing()) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          save();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
          return;
        }
        // Don't let the dnd intercept keys the contenteditable owns
        // (Cmd+A select-all, arrow caret movement, etc).
        e.stopPropagation();
      }}
      onBlur={save}
      onClick={(e) => {
        if (editing()) e.stopPropagation();
      }}
      onPointerDown={(e) => {
        if (editing()) e.stopPropagation();
      }}
    />
  );
}

// Free-form notes editor. Mounted only while the row is expanded; on
// unmount (i.e. on collapse) we flush the current text back through
// `editItemNotes` if it differs from the model. Live peer changes during
// edit are intentionally ignored — last-collapse-wins, matching how the
// row-text editor behaves while expanded. A textarea (rather than a
// contenteditable div) so newline round-trips are byte-faithful and we
// don't have to fight browser-inserted <div>/<br> markup.
function NotesField(props: {
  item: () => ItemView;
  app: DocApp;
  /** Optional holder used only on the draft path: NotesField stashes
   *  its textarea value here on unmount so the Row's collapse effect
   *  can read it after the <Show> has already torn the textarea down. */
  draftNotesRef?: { current: string };
}) {
  const { m } = useAppI18n();
  let ref!: HTMLTextAreaElement;
  const initial = props.item().notes;
  // Match content height so the field grows with the note instead of
  // showing an internal scrollbar. Run after each input so paste / type
  // / delete all stay in sync.
  const autosize = () => {
    ref.style.height = "auto";
    ref.style.height = `${ref.scrollHeight}px`;
  };
  onMount(() => {
    ref.value = initial;
    autosize();
  });
  onCleanup(() => {
    // Drafts have no engine record yet; stash the value in the holder
    // so the Row's collapse effect can hand it to `settleDraft`, which
    // applies it via `editItemNotes` on the freshly created item id.
    if (isDraftId(props.item().id)) {
      if (props.draftNotesRef) props.draftNotesRef.current = ref.value;
      return;
    }
    const next = ref.value;
    if (next !== props.item().notes) {
      props.app.editItemNotes(props.item().id, next);
    }
  });
  return (
    <textarea
      ref={ref}
      class="row-notes"
      placeholder={m().workspace.notes}
      rows={1}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onInput={autosize}
      on:keydown={(e) => {
        // Native (non-delegated) so the bubble order is textarea → dnd
        // listbox; otherwise the listbox would intercept arrows / Cmd+A
        // before we see them. Escape stays uncaught so it can collapse
        // the row through the dnd's handler.
        if (
          e.key === "ArrowUp" &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.isComposing
        ) {
          const ta = e.currentTarget as HTMLTextAreaElement;
          const x = textareaCaretXIfOnFirstLine(ta);
          if (x !== null) {
            const editable = ta
              .closest(".row")
              ?.querySelector<HTMLElement>(".row-text");
            if (editable) {
              e.preventDefault();
              e.stopPropagation();
              focusEditableLastLineAtX(editable, x);
              return;
            }
          }
        }
        if (e.key !== "Escape") e.stopPropagation();
      }}
    />
  );
}

function Row(props: {
  item: () => ItemView;
  expanded: () => boolean;
  app: DocApp;
  selection: DndSelection;
  viewKind: ViewKey["kind"];
  duplicateBlock: (sourceIds: readonly string[]) => void;
  copyBlock: (sourceIds: readonly string[]) => void;
  /** Called by a draft row from its collapse effect with the trimmed
   *  edit text and the notes textarea contents. Empty text means drop
   *  the draft; non-empty means the workspace should commit it as a
   *  real item (and apply notes as a follow-up). `chain` is true when
   *  the collapse was driven by Enter — the workspace re-opens a fresh
   *  draft so capture continues until Escape / blur / empty-Enter. */
  onDraftSettle?: (text: string, notes: string, chain: boolean) => void;
}) {
  const { m, locale } = useAppI18n();
  let textRef!: HTMLSpanElement;
  // Holder for the draft path: NotesField writes its textarea value
  // here on unmount, while the textarea still exists in the DOM. The
  // collapse effect below reads it after Solid has torn down the Show
  // (so a `querySelector(".row-notes")` would already return null).
  const draftNotesRef = { current: "" };
  // Captured by dblclick before the row expands so we can place the caret
  // where the user pointed instead of selecting all. Captured pre-expand
  // because layout may shift once the row becomes editable.
  let dblClickCaret: { node: Node; offset: number } | null = null;
  // Set by the Enter keydown handler before it dispatches the synthetic
  // Escape that drives collapse. The collapse effect reads (and resets)
  // it so the workspace can tell Enter-commit from Escape/blur and chain
  // a fresh draft only on Enter.
  let chainOnSettle = false;

  // Order matters: this effect must run *before* the model-mirror effect
  // below. On collapse, both fire in the same tick — if the mirror runs
  // first, it overwrites the user's edit with the stale model text and
  // we save nothing.
  createEffect(
    on(
      props.expanded,
      (now, prev) => {
        if (!prev && now) {
          const caret = dblClickCaret;
          dblClickCaret = null;
          queueMicrotask(() => {
            textRef.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            if (caret && textRef.contains(caret.node)) {
              range.setStart(caret.node, caret.offset);
              range.collapse(true);
            } else {
              // No dblclick caret (e.g. expanded via Enter): drop the cursor
              // at the end of the text so typing appends rather than
              // overwriting a select-all.
              range.selectNodeContents(textRef);
              range.collapse(false);
            }
            sel?.removeAllRanges();
            sel?.addRange(range);
          });
          return;
        }
        if (prev && !now) {
          dblClickCaret = null;
          const chain = chainOnSettle;
          chainOnSettle = false;
          const next = (textRef.textContent ?? "").trim();
          // Draft path: the row is a transient pseudo-item that has no
          // engine-side record yet. Hand the trimmed text back to the
          // workspace, which decides commit (addItemAt) vs drop. Skip the
          // editItemText path — there's no item to edit.
          if (isDraftId(props.item().id)) {
            // NotesField has already unmounted by the time this effect
            // runs (the <Show> wrapping it tears down synchronously);
            // read the value it stashed in draftNotesRef during its
            // onCleanup instead of querying the now-detached textarea.
            props.onDraftSettle?.(next, draftNotesRef.current, chain);
            // When chaining, the workspace will open a fresh draft and
            // its expand effect will steal focus to the new row's
            // contentEditable; bouncing focus to the listbox here would
            // race that. Skip the listbox refocus on the chain path.
            if (!chain) {
              const listbox = textRef.closest<HTMLElement>('[role="listbox"]');
              listbox?.focus();
            }
            return;
          }
          const current = props.item().text;
          if (!next) {
            textRef.textContent = current;
          } else if (next !== current) {
            props.app.editItemText(props.item().id, next);
          }
          // Focus is still on the now-non-editable span; bounce it back
          // to the dnd listbox so arrow-key nav works without a click.
          const listbox = textRef.closest<HTMLElement>('[role="listbox"]');
          listbox?.focus();
        }
      },
      { defer: true },
    ),
  );

  const captureDblClickCaret = (e: MouseEvent) => {
    type CPFP = (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    const cpfp = (
      document as unknown as { caretPositionFromPoint?: CPFP }
    ).caretPositionFromPoint;
    let node: Node | null = null;
    let offset = 0;
    if (cpfp) {
      const pos = cpfp.call(document, e.clientX, e.clientY);
      if (pos) {
        node = pos.offsetNode;
        offset = pos.offset;
      }
    }
    if (!node) {
      const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    }
    if (node && textRef.contains(node)) {
      dblClickCaret = { node, offset };
      return;
    }
    // Click landed outside the text span — typically the row's padding
    // above or below the text. Snap to the end of the text instead of
    // falling through to select-all.
    dblClickCaret = { node: textRef, offset: textRef.childNodes.length };
  };

  // Mirror the model into the DOM while not expanded. While expanded
  // we leave the DOM alone so live edits aren't clobbered by reactive
  // updates from peer text changes.
  createEffect(() => {
    if (!props.expanded()) textRef.textContent = props.item().text;
  });

  // If the right-clicked row is already in the multi-select, act on the
  // whole selection; otherwise act on this row alone. The onOpenChange
  // hook below makes sure that an unselected row becomes the sole
  // selection before the menu actually opens.
  const targetIds = (): string[] => {
    const id = props.item().id;
    return props.selection.isSelected(id)
      ? props.selection.getSelectedKeys().map(String)
      : [id];
  };
  const binTargets = (): string[] =>
    targetIds().filter((k) => {
      const it = props.app.getItem(k);
      return it !== undefined && !isBinned(it);
    });
  const onBin = () => {
    const ids = binTargets();
    if (ids.length === 0) return;
    props.app.setBinnedMany(ids, true);
  };
  const onMarkDone = () => {
    const ids = targetIds();
    if (ids.length === 0) return;
    props.app.setDoneMany(ids, true);
  };
  const onMarkNotDone = () => {
    const ids = targetIds();
    if (ids.length === 0) return;
    props.app.setDoneMany(ids, false);
  };
  // Restore from bin: clear binned only, preserving done state. A
  // done-then-binned item lands back in the Done view; a plain binned
  // item back in its list. The user can flip done off explicitly via
  // the row checkbox or "Mark as not done" if needed.
  const onRestore = () => {
    const ids = targetIds().filter((id) => {
      const it = props.app.getItem(id);
      return it !== undefined && isBinned(it);
    });
    if (ids.length === 0) return;
    props.app.setBinnedMany(ids, false);
  };
  const onDelete = () => {
    const ids = targetIds().filter((id) => {
      const it = props.app.getItem(id);
      return it !== undefined && isBinned(it);
    });
    if (ids.length === 0) return;
    props.app.deleteBinnedMany(ids);
  };
  const onDuplicate = () => {
    props.duplicateBlock(targetIds());
  };
  const onCopy = () => {
    props.copyBlock(targetIds());
  };
  const onOpenChange = (open: boolean) => {
    if (!open) return;
    const id = props.item().id;
    if (!props.selection.isSelected(id)) {
      props.selection.selectOnly(id);
    }
  };
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenu.Trigger
        class="row"
        data-done={isDone(props.item()) ? "" : undefined}
        data-binned={isBinned(props.item()) ? "" : undefined}
        data-expanded={props.expanded() ? "" : undefined}
        on:dblclick={(e) => {
          // Listen at the row level (not the text span) so dblclicks in
          // the row's padding above/below the text still capture a caret.
          // Native (non-delegated) so it runs in the bubble phase before
          // the dnd listbox's dblclick handler triggers expansion — once
          // the row expands, contentEditable flips and layout may shift.
          if (props.expanded()) return;
          captureDblClickCaret(e);
        }}
      >
        <input
          type="checkbox"
          checked={isDone(props.item())}
          onChange={(e) =>
            props.app.setDone(props.item().id, e.currentTarget.checked)
          }
        />
        <div class="row-body">
          <span
            ref={textRef}
            class="row-text"
            contentEditable={props.expanded()}
            onClick={(e) => {
              if (props.expanded()) e.stopPropagation();
            }}
            onPointerDown={(e) => {
              if (props.expanded()) e.stopPropagation();
            }}
            on:input={() => {
              // Browsers (Chrome, Firefox) leave a stray <br> behind when
              // the user deletes the last character of a contenteditable,
              // which defeats the `:empty::before` placeholder. Strip it
              // when the visible text is empty so the placeholder returns.
              if (textRef.textContent === "" && textRef.firstChild) {
                textRef.replaceChildren();
              }
            }}
            on:blur={(e) => {
              // iOS Safari's form-assistant bar (the prev/next/Done strip
              // above the keyboard) blurs the contenteditable on Done
              // without firing a keydown — the row would otherwise stay
              // expanded with the keyboard gone. Treat focus leaving the
              // row entirely as a commit, mirroring the Enter path. Skip
              // when focus is moving to another element inside the same
              // row (e.g. tapping into the notes textarea) so the user can
              // still hop fields without collapsing.
              if (!props.expanded()) return;
              const next = e.relatedTarget as Node | null;
              const row = (e.currentTarget as HTMLElement).closest(".row");
              if (next && row?.contains(next)) return;
              // First Escape: dnd is expanded → collapse. Second Escape:
              // dnd is now collapsed → clears selection. Without the
              // second one the row's pre-expand selection chrome flashes
              // visible on desktop until the next click selects another
              // row on mouseup; the dnd bails on mousedown while expanded
              // so selection only updates on the click. The Enter path
              // doesn't hit this because there's no follow-up click.
              const target = e.currentTarget as HTMLElement;
              target.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
              );
              target.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
              );
            }}
            on:keydown={(e) => {
              // Native (non-delegated) so the bubble order is span → dnd
              // listbox; Solid's delegated `onKeyDown` fires at document
              // level *after* the listbox sees the event, so a delegated
              // stopPropagation here would be too late (Cmd+A would still
              // hit the dnd's select-all).
              if (!props.expanded()) return;
              if (e.key === "Enter" && !e.shiftKey) {
                // Suppress the newline; bounce off the dnd's Escape
                // handler (bound on its listbox) to drive collapse, which
                // triggers the save effect above. Stop propagation so the
                // workspace's document-level Enter handler doesn't see the
                // original event after the synchronous Escape dispatch has
                // already flipped contentEditable off on this span — the
                // editable-surface guard there would no longer match and
                // it would re-expand the row.
                e.preventDefault();
                e.stopPropagation();
                // Mark this as the Enter-commit path so the collapse
                // effect tells the workspace to chain another draft.
                // Escape and blur reach the same collapse without setting
                // this flag, so they end the chain.
                chainOnSettle = true;
                (e.currentTarget as HTMLElement).dispatchEvent(
                  new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
                );
                return;
              }
              // ArrowDown on the last visual line jumps to the notes
              // textarea below, landing at the matching X. On any other
              // line, fall through to the browser's default (caret moves
              // down within the editable).
              if (
                e.key === "ArrowDown" &&
                !e.shiftKey &&
                !e.altKey &&
                !e.metaKey &&
                !e.ctrlKey &&
                !e.isComposing
              ) {
                const editable = e.currentTarget as HTMLElement;
                const x = caretXIfOnLastLine(editable);
                if (x !== null) {
                  const notes = editable
                    .closest(".row")
                    ?.querySelector<HTMLTextAreaElement>(".row-notes");
                  if (notes) {
                    e.preventDefault();
                    e.stopPropagation();
                    focusTextareaFirstLineAtX(notes, x);
                    return;
                  }
                }
              }
              // Don't let the dnd intercept keys the contenteditable owns.
              if (e.key !== "Escape") e.stopPropagation();
            }}
          />
          <Show when={props.expanded()}>
            <NotesField
              item={props.item}
              app={props.app}
              draftNotesRef={draftNotesRef}
            />
          </Show>
        </div>
        <Show when={statusTimestamp(props.item())}>
          {(ts) => (
            <span class="row-timestamp" title={new Date(ts()).toLocaleString(locale())}>
              {props.viewKind === "done"
                ? formatDoneStamp(ts(), nowMs(), locale())
                : formatRelative(ts(), nowMs(), locale())}
            </span>
          )}
        </Show>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content class="context-menu-content">
          <Show when={!isDone(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onMarkDone}>
              {m().workspace.markDone}
            </ContextMenu.Item>
          </Show>
          <Show when={isDone(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onMarkNotDone}>
              {m().workspace.markNotDone}
            </ContextMenu.Item>
          </Show>
          <ContextMenu.Item class="context-menu-item" onSelect={onCopy}>
            {m().common.copy}
          </ContextMenu.Item>
          <Show when={isInListView(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onDuplicate}>
              {m().workspace.duplicate}
            </ContextMenu.Item>
          </Show>
          <Show when={!isBinned(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onBin}>
              {m().workspace.moveToBin}
            </ContextMenu.Item>
          </Show>
          <Show when={isBinned(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onRestore}>
              {m().common.restore}
            </ContextMenu.Item>
            <ContextMenu.Item class="context-menu-item" onSelect={onDelete}>
              {m().common.delete}
            </ContextMenu.Item>
          </Show>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
