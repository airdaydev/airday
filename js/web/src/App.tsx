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
import {
  NullStorage,
  OpfsStorage,
  probeOpfs,
  type StorageAdapter,
} from "@airday/core";
import { ContextMenu } from "@kobalte/core/context-menu";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Popover } from "@kobalte/core/popover";
import {
  Dnd,
  DndSelection,
  type DndImperative,
  type DndOp,
} from "@primavera-ui/components/dnd/solid";
import type { DndDragEventDetail } from "@primavera-ui/components/dnd";
import dotsVerticalSvg from "./icons/dots-vertical.svg?raw";
import plusSvg from "./icons/plus.svg?raw";
import { api } from "./api.ts";
import { dekVault } from "./dekVault.ts";
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

type ViewKey =
  | { kind: "list"; id: string }
  | { kind: "done" }
  | { kind: "bin" };

const CLIENT_NAME = "airday-web";
const CLIENT_VERSION = "0.1.0";

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

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthDayFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const monthDayYearFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

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

function formatRelative(ts: number, now: number): string {
  const diffMs = now - ts;
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  const tsDate = new Date(ts);
  const nowDate = new Date(now);
  const days = calendarDayDiff(nowDate, tsDate);
  if (days === 1) return `Yesterday ${timeFmt.format(tsDate)}`;
  if (days < 7) return `${weekdayFmt.format(tsDate)} ${timeFmt.format(tsDate)}`;
  if (tsDate.getFullYear() === nowDate.getFullYear()) return monthDayFmt.format(tsDate);
  return monthDayYearFmt.format(tsDate);
}

export function App() {
  // `undefined` = vault probe still in flight; once it resolves we
  // either restore the persisted session or auto-mint a fresh
  // anonymous one — `session()` is never null after that point.
  const [session, setSession] = createSignal<Session | undefined>(undefined);
  const [online, setOnline] = createSignal(false);
  const [boot, setBoot] = createSignal<{ doc: Doc; lastAcked: bigint } | null>(
    null,
  );
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
    setSession(await createAnonymousSession());
  };

  const onAuthenticated = (s: Session) => {
    // Local-only anonymous data is left to drift in OPFS under the
    // old anon accountId. It'll never be addressed again — option C
    // says clobber, not migrate. A future cleanup pass can reap it.
    setBoot(null);
    setBootError(null);
    setOnline(false);
    setSession(s);
  };

  return (
    <Show
      when={session() !== undefined && opfsOk() !== null}
      fallback={<div class="empty">Loading…</div>}
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
            logout={logout}
            onSession={onAuthenticated}
            opfsOk={opfsOk() ?? false}
          />
        )}
      </Show>
    </Show>
  );
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
    // Seed the doc on first run — Doc.create() includes the built-in
    // "Later" list. On reload we read OPFS instead.
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

function BootGate(props: {
  session: Session;
  boot: { doc: Doc; lastAcked: bigint } | null;
  bootError: string | null;
  setBoot: (b: { doc: Doc; lastAcked: bigint } | null) => void;
  setBootError: (m: string | null) => void;
  online: boolean;
  setOnline: (b: boolean) => void;
  logout: () => void;
  onSession: (s: Session) => void;
  opfsOk: boolean;
}) {
  // Try to restore a doc + frontier from OPFS. On signup we always
  // start with a seeded Doc.create(); on login we prefer OPFS if the
  // cached snapshot decrypts cleanly with the DEK we just unwrapped.
  // Failures fall through to an empty doc — sync will catch us up.
  // Kick the async load on mount; the resulting `setBoot` flips the
  // <Show> below so MainApp mounts once.
  void (async () => {
    try {
      if (props.session.freshSignup) {
        props.setBoot({ doc: Doc.create(), lastAcked: 0n });
        return;
      }
      if (!props.opfsOk) {
        props.setBoot({ doc: Doc.empty(), lastAcked: 0n });
        return;
      }
      const storage = new OpfsStorage(
        props.session.accountId,
        props.session.dek.clone(),
        EncryptedBlob,
      );
      const docBytes = await storage.getDoc();
      const device = await storage.getDevice();
      if (docBytes) {
        props.setBoot({
          doc: Doc.load(docBytes),
          lastAcked: BigInt(device?.lastAckedOpId ?? 0),
        });
      } else {
        props.setBoot({ doc: Doc.empty(), lastAcked: 0n });
      }
    } catch (e) {
      props.setBootError(e instanceof Error ? e.message : String(e));
      props.setBoot({ doc: Doc.empty(), lastAcked: 0n });
    }
  })();

  return (
    <Show when={props.boot} fallback={<div class="empty">Loading…</div>}>
      {(b) => (
        <MainApp
          session={props.session}
          boot={b()}
          bootError={props.bootError}
          setOnline={props.setOnline}
          online={props.online}
          logout={props.logout}
          onSession={props.onSession}
          opfsOk={props.opfsOk}
        />
      )}
    </Show>
  );
}

function MainApp(props: {
  session: Session;
  boot: { doc: Doc; lastAcked: bigint };
  bootError: string | null;
  online: boolean;
  setOnline: (b: boolean) => void;
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
  // Both SyncEngine and OpfsStorage consume their Dek argument, and
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

  const storage: StorageAdapter = props.opfsOk
    ? new OpfsStorage(
        props.session.accountId,
        props.session.dek.clone(),
        EncryptedBlob,
      )
    : new NullStorage();

  // Anonymous sessions are local-only by definition — no account on
  // the server to authenticate to. Skip the WebSocket pump entirely;
  // local mutations still flow through the engine for OPFS persist.
  let bridge: SyncBridge | null = null;
  if (!props.session.anonymous) {
    bridge = new SyncBridge({
      engine,
      onChange: (kind) => {
        if (kind === "online") props.setOnline(true);
        if (kind === "offline") props.setOnline(false);
      },
      onAppEvents: () => app.drainEvents(),
    });
    const b = bridge;
    app.setOnFlush(() => b.pumpOutbox());
    bridge.start();
    onCleanup(() => b.stop());
  }

  // Debounced persistence. Every doc change (local mutation or
  // remote apply) bumps `app.version()`; we coalesce a window of
  // 500ms and write a fresh snapshot. The visibility-hidden listener
  // is the belt-and-suspenders save for tab-close.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveNow = async () => {
    saveTimer = null;
    try {
      const bytes = engine.save();
      // Anonymous sessions skip the device record — its DeviceConfig
      // shape requires email + deviceId, neither of which exist
      // before signup, and lastAckedOpId / lastSyncAt are meaningless
      // without a server peer. The doc snapshot still rides through
      // putDoc so reload restores local data.
      if (props.session.anonymous) {
        await storage.putDoc(bytes);
      } else {
        const lastAcked = engine.highestSeenOpId();
        await Promise.all([
          storage.putDoc(bytes),
          storage.putDevice({
            accountId: props.session.accountId,
            email: props.session.email!,
            // Bundle is served from the same origin as the API; record
            // that origin for completeness even though the cookie is the
            // load-bearing piece of "which server am I talking to".
            serverUrl: window.location.origin,
            deviceId: props.session.deviceId!,
            lastAckedOpId: Number(lastAcked),
            lastSyncAt: Date.now(),
          }),
        ]);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("opfs save failed:", e);
    }
  };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  };
  createEffect(() => {
    app.version();
    scheduleSave();
  });
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      if (saveTimer) clearTimeout(saveTimer);
      void saveNow();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (saveTimer) clearTimeout(saveTimer);
  });

  if (typeof window !== "undefined") {
    (window as any).__airday = { app, engine, bridge, storage };
  }

  return (
    <Workspace
      app={app}
      session={props.session}
      online={props.online}
      logout={props.logout}
      onSession={props.onSession}
    />
  );
}

function Workspace(props: {
  app: DocApp;
  session: Session;
  online: boolean;
  logout: () => void;
  onSession: (s: Session) => void;
}) {
  const app = props.app;
  const state = app.state;
  const [view, setView] = createSignal<ViewKey>({ kind: "list", id: "main" });
  const [dndItems, setDndItems] = createSignal<ItemView[]>([]);
  const [themePref, setThemePref] = createSignal<ThemePreference>(theme.get());
  const [settingsOpen, setSettingsOpen] = createSignal(false);
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

  const dndRevision = createMemo(() => {
    const v = view();
    return `${v.kind}:${v.kind === "list" ? v.id : "-"}`;
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
    app.withUndoGroup(() => {
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
  const settleDraft = (text: string) => {
    const d = draft();
    if (!d) return;
    setDraft(null);
    if (!text) return;
    const newId = app.addItemAt(d.listId, text, d.insertIndex);
    // The store dispatch that adds the new item runs before this
    // microtask, so by then `selection.updateOrder` has already seen
    // the new id and the selection anchor is valid.
    queueMicrotask(() => selection.selectOnly(newId));
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
    app.withUndoGroup(() => {
      if (v.kind === "bin") {
        for (const id of ids) app.deleteBinned(id);
      } else {
        for (const id of ids) app.setBinned(id, true);
      }
    });
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
      app.withUndoGroup(() => {
        for (const id of toBin) app.setBinned(id, true);
      });
      selection.clear();
      return;
    }
    app.withUndoGroup(() => {
      for (const [i, id] of idsInOrder.entries()) {
        const it = app.getItem(id);
        // Drop into a list = "put this back into the visible list view".
        // Both flags must clear; otherwise the item stays in done/bin
        // and `moveItem`'s target_index counts the wrong slots.
        if (it && isDone(it)) app.setDone(id, false);
        if (it && isBinned(it)) app.setBinned(id, false);
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

  return (
    <div class="app">
      <Nav
        app={app}
        lists={lists()}
        view={view()}
        setView={setView}
        session={props.session}
        online={props.online}
        logout={props.logout}
        onOpenSettings={() => setSettingsOpen(true)}
        onSession={props.onSession}
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
          <h1>{viewTitle(view(), lists())}</h1>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <Show
              when={
                view().kind === "bin" &&
                items().length > 0
              }
            >
              <button type="button" onClick={() => app.emptyBin()}>
                Empty bin
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
                aria-label="Add"
                innerHTML={plusSvg}
              />
            </Show>
          </div>
        </header>
        <Show
          when={dndItems().length > 0}
          fallback={
            <div class="dnd-host empty">
              {view().kind === "list" && matchesKbDevice()
                ? "Press Space to create a new item"
                : "Nothing here yet."}
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
              itemHeight={28}
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
                  duplicateBlock={duplicateBlock}
                  onDraftSettle={settleDraft}
                />
              )}
            </Dnd>
          </Show>
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

function viewTitle(v: ViewKey, lists: { id: string; name: string }[]): string {
  if (v.kind === "list") {
    if (v.id === "main") return "Desk";
    return lists.find((l) => l.id === v.id)?.name ?? v.id;
  }
  if (v.kind === "done") return "Done";
  return "Bin";
}

function Nav(props: {
  app: DocApp;
  lists: { id: string; name: string }[];
  view: ViewKey;
  setView: (v: ViewKey) => void;
  session: Session;
  online: boolean;
  logout: () => void;
  onOpenSettings: () => void;
  onSession: (s: Session) => void;
}) {
  const [adding, setAdding] = createSignal(false);
  const [authOpen, setAuthOpen] = createSignal(false);
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

  const navSelection = new DndSelection();

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
  return (
    <nav class="nav">
      <div class="nav-group">
        <button
          type="button"
          class="nav-item"
          data-active={
            props.view.kind === "list" && props.view.id === "main" ? "" : undefined
          }
          data-drop-list-id="main"
          onClick={() => props.setView({ kind: "list", id: "main" })}
        >
          Desk
        </button>
        <button
          type="button"
          class="nav-item"
          data-active={props.view.kind === "done" ? "" : undefined}
          onClick={() => props.setView({ kind: "done" })}
        >
          Done
        </button>
        <button
          type="button"
          class="nav-item"
          data-active={props.view.kind === "bin" ? "" : undefined}
          data-drop-bin=""
          onClick={() => props.setView({ kind: "bin" })}
        >
          Bin
        </button>
      </div>
      <div class="nav-group">
        <Show when={props.lists.length > 0}>
          <Dnd
            items={dndLists()}
            setItems={setDndLists}
            getKey={(l) => l.id}
            itemHeight={28}
            multi={false}
            clearOnClickOutside
            selection={navSelection}
            onReorder={onReorder}
          >
            {(l) => (
              <ContextMenu
                onOpenChange={(open) => {
                  if (open) navSelection.selectOnly(l().id);
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
                  onClick={() => props.setView({ kind: "list", id: l().id })}
                >
                  <EditableNavLabel
                    name={l().name}
                    onSave={(name) => props.app.renameList(l().id, name)}
                  />
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content class="context-menu-content">
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
                      Delete
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu>
            )}
          </Dnd>
        </Show>
        <Show
          when={adding()}
          fallback={
            <button type="button" class="nav-item" onClick={() => setAdding(true)}>
              + New list
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
            <Popover.Trigger class="signin-button">Sign in</Popover.Trigger>
            <Popover.Portal>
              <Popover.Content class="auth-popover">
                <AuthForm onSession={handleSession} />
              </Popover.Content>
            </Popover.Portal>
          </Popover>
        </Show>
        <Show when={!props.session.anonymous}>
          <span class="pro-badge">
            Pro
            <Show when={!props.online}>
              <span
                class="offline-indicator"
                title="Disconnected"
                aria-label="Disconnected"
              >
                <CloudOffIcon />
              </span>
            </Show>
          </span>
        </Show>
        <DropdownMenu>
          <DropdownMenu.Trigger
            class="nav-menu-trigger"
            aria-label="Menu"
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
                <span>Undo</span>
                <kbd class="menu-shortcut">⌘Z</kbd>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="dropdown-menu-item"
                disabled={!canRedo()}
                onSelect={() => {
                  props.app.redo();
                }}
              >
                <span>Redo</span>
                <kbd class="menu-shortcut">⌘⇧Z</kbd>
              </DropdownMenu.Item>
              <DropdownMenu.Separator class="dropdown-menu-separator" />
              <DropdownMenu.Item
                class="dropdown-menu-item"
                onSelect={() => props.onOpenSettings()}
              >
                Settings
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="dropdown-menu-item"
                as="a"
                href="https://air.day/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Airday website
              </DropdownMenu.Item>
              <Show when={!props.session.anonymous}>
                <DropdownMenu.Item
                  class="dropdown-menu-item"
                  onSelect={() => props.logout()}
                >
                  Log out
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
  let inputRef!: HTMLInputElement;
  onMount(() => inputRef.focus());
  return (
    <form onSubmit={props.onSubmit}>
      <input
        ref={inputRef}
        class="nav-item nav-item-input"
        type="text"
        placeholder="+ New list"
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
}) {
  let ref!: HTMLSpanElement;
  const [editing, setEditing] = createSignal(false);

  // While not editing, the span's text mirrors the model. While editing
  // we leave the DOM alone so the user's in-flight edits aren't clobbered
  // by reactive updates (including ones from peer renames).
  createEffect(() => {
    if (!editing()) ref.textContent = props.name;
  });

  const startEdit = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (editing()) return;
    setEditing(true);
    queueMicrotask(() => {
      ref.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ref);
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  };

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
      class="nav-item-label"
      contentEditable={editing()}
      onDblClick={startEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
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
function NotesField(props: { item: () => ItemView; app: DocApp }) {
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
    const next = ref.value;
    if (next !== props.item().notes) {
      props.app.editItemNotes(props.item().id, next);
    }
  });
  return (
    <textarea
      ref={ref}
      class="row-notes"
      placeholder="Notes"
      rows={1}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onInput={autosize}
      on:keydown={(e) => {
        // Native (non-delegated) so the bubble order is textarea → dnd
        // listbox; otherwise the listbox would intercept arrows / Cmd+A
        // before we see them. Escape stays uncaught so it can collapse
        // the row through the dnd's handler.
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
  duplicateBlock: (sourceIds: readonly string[]) => void;
  /** Called by a draft row from its collapse effect with the trimmed
   *  edit text. Empty text means drop the draft; non-empty means the
   *  workspace should commit it as a real item. */
  onDraftSettle?: (text: string) => void;
}) {
  let textRef!: HTMLSpanElement;
  // Captured by dblclick before the row expands so we can place the caret
  // where the user pointed instead of selecting all. Captured pre-expand
  // because layout may shift once the row becomes editable.
  let dblClickCaret: { node: Node; offset: number } | null = null;

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
          const next = (textRef.textContent ?? "").trim();
          // Draft path: the row is a transient pseudo-item that has no
          // engine-side record yet. Hand the trimmed text back to the
          // workspace, which decides commit (addItemAt) vs drop. Skip the
          // editItemText path — there's no item to edit.
          if (isDraftId(props.item().id)) {
            props.onDraftSettle?.(next);
            const listbox = textRef.closest<HTMLElement>('[role="listbox"]');
            listbox?.focus();
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
    props.app.withUndoGroup(() => {
      for (const id of binTargets()) props.app.setBinned(id, true);
    });
  };
  const onMarkDone = () => {
    props.app.withUndoGroup(() => {
      for (const id of targetIds()) props.app.setDone(id, true);
    });
  };
  const onMarkNotDone = () => {
    props.app.withUndoGroup(() => {
      for (const id of targetIds()) props.app.setDone(id, false);
    });
  };
  // Restore from bin: clear binned only, preserving done state. A
  // done-then-binned item lands back in the Done view; a plain binned
  // item back in its list. The user can flip done off explicitly via
  // the row checkbox or "Mark as not done" if needed.
  const onRestore = () => {
    props.app.withUndoGroup(() => {
      for (const id of targetIds()) {
        const it = props.app.getItem(id);
        if (it && isBinned(it)) props.app.setBinned(id, false);
      }
    });
  };
  const onDelete = () => {
    props.app.withUndoGroup(() => {
      for (const id of targetIds()) {
        const it = props.app.getItem(id);
        if (it && isBinned(it)) props.app.deleteBinned(id);
      }
    });
  };
  const onDuplicate = () => {
    props.duplicateBlock(targetIds());
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
                (e.currentTarget as HTMLElement).dispatchEvent(
                  new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
                );
                return;
              }
              // Don't let the dnd intercept keys the contenteditable owns.
              if (e.key !== "Escape") e.stopPropagation();
            }}
          />
          <Show when={props.expanded() && !isDraftId(props.item().id)}>
            <NotesField item={props.item} app={props.app} />
          </Show>
        </div>
        <Show when={statusTimestamp(props.item())}>
          {(ts) => (
            <span class="row-timestamp" title={new Date(ts()).toLocaleString()}>
              {formatRelative(ts(), nowMs())}
            </span>
          )}
        </Show>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content class="context-menu-content">
          <Show when={!isDone(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onMarkDone}>
              Mark as done
            </ContextMenu.Item>
          </Show>
          <Show when={isDone(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onMarkNotDone}>
              Mark as not done
            </ContextMenu.Item>
          </Show>
          <Show when={isInListView(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onDuplicate}>
              Duplicate
            </ContextMenu.Item>
          </Show>
          <Show when={!isBinned(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onBin}>
              Move to bin
            </ContextMenu.Item>
          </Show>
          <Show when={isBinned(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onRestore}>
              Restore
            </ContextMenu.Item>
            <ContextMenu.Item class="context-menu-item" onSelect={onDelete}>
              Delete
            </ContextMenu.Item>
          </Show>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
