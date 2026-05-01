// Top-level app. Login form gates the main UI; on success we open a
// Doc + SyncEngine and start the WebSocket pump. The post-login UI
// is the same shape as Stage 3's Doc-only build, but every read /
// mutation goes through the engine so peer ops apply live.

import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { Doc, EncryptedBlob, SyncEngine } from "@airday/core/wasm";
import {
  NullStorage,
  OpfsStorage,
  probeOpfs,
  type StorageAdapter,
} from "@airday/core";
import { ContextMenu } from "@kobalte/core/context-menu";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { SegmentedControl } from "@kobalte/core/segmented-control";
import { Dnd, DndSelection, type DndOp } from "@primavera-ui/components/dnd/solid";
import { api } from "./api.ts";
import { dekVault } from "./dekVault.ts";
import { Login, type Session } from "./Login.tsx";
import {
  createSyncedApp,
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

// Module-level so the OS-preference listener is registered exactly
// once for the lifetime of the page.
const theme = createTheme();

export function App() {
  // `undefined` = vault probe still in flight; `null` = no session, show
  // login; `Session` = logged in. Booting straight into Login would
  // flash the form for users who already have a persisted session.
  const [session, setSession] = createSignal<Session | null | undefined>(
    undefined,
  );
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
  // unwrap it, the device cookie should still be valid — the WS pump
  // will surface the failure if it isn't.
  void (async () => {
    try {
      const v = await dekVault.load();
      if (v) {
        setSession({
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
    setSession(null);
  })();

  const logout = async () => {
    try {
      await api.logout();
    } catch (e) {
      // Best-effort: even if the server call fails (offline, expired
      // cookie), drop local state so the next login is clean.
      console.warn("logout call failed:", e);
    }
    await dekVault.clear();
    setBoot(null);
    setBootError(null);
    setOnline(false);
    setSession(null);
  };

  return (
    <Show
      when={session() !== undefined && opfsOk() !== null}
      fallback={<div class="empty">Loading…</div>}
    >
      <Show when={session()} fallback={<Login onSession={setSession} />}>
        {(s) => (
          <BootGate
            session={s()}
            boot={boot()}
            bootError={bootError()}
            setBoot={setBoot}
            setBootError={setBootError}
            online={online()}
            setOnline={setOnline}
            logout={logout}
            opfsOk={opfsOk() ?? false}
          />
        )}
      </Show>
    </Show>
  );
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
  opfsOk: boolean;
}) {
  // eslint-disable-next-line no-console
  console.debug(
    "MainApp mount, freshSignup=",
    props.session.freshSignup,
    "lastAcked=",
    String(props.boot.lastAcked),
  );
  // Dek is consumed by SyncEngine — clone first so we can also use
  // it for OPFS encrypt-at-rest.
  const dekForStorage = props.session.dek.clone();
  const engine = new SyncEngine(
    props.boot.doc,
    props.session.dek,
    props.boot.lastAcked,
    CLIENT_NAME,
    CLIENT_VERSION,
  );
  const app = createSyncedApp(engine);

  const storage: StorageAdapter = props.opfsOk
    ? new OpfsStorage(props.session.accountId, dekForStorage, EncryptedBlob)
    : new NullStorage();

  const bridge = new SyncBridge({
    engine,
    onChange: (kind) => {
      if (kind === "online") props.setOnline(true);
      if (kind === "offline") props.setOnline(false);
    },
    onAppEvents: () => app.drainEvents(),
  });
  app.setOnFlush(() => bridge.pumpOutbox());
  bridge.start();
  onCleanup(() => bridge.stop());

  // Debounced persistence. Every doc change (local mutation or
  // remote apply) bumps `app.version()`; we coalesce a window of
  // 500ms and write a fresh snapshot. The visibility-hidden listener
  // is the belt-and-suspenders save for tab-close.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const saveNow = async () => {
    saveTimer = null;
    try {
      const bytes = engine.save();
      const lastAcked = engine.highestSeenOpId();
      await Promise.all([
        storage.putDoc(bytes),
        storage.putDevice({
          accountId: props.session.accountId,
          email: props.session.email,
          // Bundle is served from the same origin as the API; record
          // that origin for completeness even though the cookie is the
          // load-bearing piece of "which server am I talking to".
          serverUrl: window.location.origin,
          deviceId: props.session.deviceId,
          lastAckedOpId: Number(lastAcked),
          lastSyncAt: Date.now(),
        }),
      ]);
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
    />
  );
}

function Workspace(props: {
  app: DocApp;
  session: Session;
  online: boolean;
  logout: () => void;
}) {
  const app = props.app;
  const state = app.state;
  const [view, setView] = createSignal<ViewKey>({ kind: "list", id: "main" });
  const [dndItems, setDndItems] = createSignal<ItemView[]>([]);
  const [themePref, setThemePref] = createSignal<ThemePreference>(theme.get());

  // One selection model per Workspace instance — the Dnd component is
  // re-keyed on view change (so it remounts), but we re-use the selection
  // object so consumers always read from the same handle. Stale block
  // anchors from the previous view's keys would resolve to position 0
  // (giving phantom selection at the top of the new list), so clear when
  // the view switches.
  const selection = new DndSelection();
  createEffect(on(view, () => selection.clear(), { defer: true }));

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
      return all.filter((it) => it.listId === v.id && it.status === "live");
    }
    if (v.kind === "done") {
      return all
        .filter((it) => it.status === "done")
        .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    }
    return all
      .filter((it) => it.status === "binned")
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
    setDndItems(next);
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
    for (const [index, id] of nextIds.entries()) {
      if (currentIds[index] !== id) {
        const currentIndex = currentIds.indexOf(id);
        if (currentIndex < 0) continue;
        app.moveItem(id, v.id, index);
        currentIds.splice(currentIndex, 1);
        currentIds.splice(index, 0, id);
      }
    }
  };

  const addItem = (text: string) => {
    const v = view();
    const listId = v.kind === "list" ? v.id : "main";
    app.addItem(listId, text);
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
      .map((l) => l.trim())
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

  return (
    <div class="app">
      <Nav app={app} lists={lists()} view={view()} setView={setView} />
      <main class="main">
        <header class="main-header">
          <h1>{viewTitle(view(), lists())}</h1>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <Show when={!props.online}>
              <span
                class="offline-indicator"
                title="Disconnected"
                aria-label="Disconnected"
              >
                <CloudOffIcon />
              </span>
            </Show>
            <SegmentedControl
              class="theme-segmented"
              aria-label="Appearance"
              value={themePref()}
              onChange={(value) => {
                const pref = value as ThemePreference;
                setThemePref(pref);
                theme.set(pref);
              }}
            >
              <SegmentedControl.Item value="auto" class="theme-segment">
                <SegmentedControl.ItemInput />
                <SegmentedControl.ItemControl class="theme-segment-control">
                  <SegmentedControl.ItemLabel>Auto</SegmentedControl.ItemLabel>
                </SegmentedControl.ItemControl>
              </SegmentedControl.Item>
              <SegmentedControl.Item value="light" class="theme-segment">
                <SegmentedControl.ItemInput />
                <SegmentedControl.ItemControl
                  class="theme-segment-control"
                  aria-label="Light"
                >
                  <SunIcon />
                </SegmentedControl.ItemControl>
              </SegmentedControl.Item>
              <SegmentedControl.Item value="dark" class="theme-segment">
                <SegmentedControl.ItemInput />
                <SegmentedControl.ItemControl
                  class="theme-segment-control"
                  aria-label="Dark"
                >
                  <MoonIcon />
                </SegmentedControl.ItemControl>
              </SegmentedControl.Item>
            </SegmentedControl>
            <DropdownMenu>
              <DropdownMenu.Trigger
                class="avatar-trigger"
                aria-label="Account"
              />
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="dropdown-menu-content">
                  <div class="dropdown-menu-label">{props.session.email}</div>
                  <DropdownMenu.Separator class="dropdown-menu-separator" />
                  <DropdownMenu.Item
                    class="dropdown-menu-item"
                    onSelect={() => props.logout()}
                  >
                    Log out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
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
              <AddForm onAdd={addItem} />
            </Show>
          </div>
        </header>
        <div class="dnd-host">
          <Show
            when={items().length > 0}
            fallback={<div class="empty">Nothing here yet.</div>}
          >
            <Show keyed when={dndRevision()}>
              <Dnd
                items={dndItems()}
                setItems={setDndItems}
                getKey={(it) => it.id}
                selection={selection}
                itemHeight={28}
                expandable
                clearOnClickOutside
                onReorder={onReorder}
                style={{ height: "100%", display: "block" }}
              >
                {(item, expanded) => (
                  <Row
                    item={item}
                    expanded={expanded}
                    app={app}
                    selection={selection}
                  />
                )}
              </Dnd>
            </Show>
          </Show>
        </div>
      </main>
    </div>
  );
}

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
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
  if (v.kind === "list") return lists.find((l) => l.id === v.id)?.name ?? v.id;
  if (v.kind === "done") return "Done";
  return "Bin";
}

function Nav(props: {
  app: DocApp;
  lists: { id: string; name: string }[];
  view: ViewKey;
  setView: (v: ViewKey) => void;
}) {
  const [adding, setAdding] = createSignal(false);
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
  const mainList = () => props.lists.find((l) => l.id === "main");
  const otherLists = createMemo(() => props.lists.filter((l) => l.id !== "main"));
  type NavList = { id: string; name: string };
  const [dndLists, setDndLists] = createSignal<NavList[]>([]);
  createEffect(() => setDndLists(otherLists()));

  const navSelection = new DndSelection();

  // Section 2 only contains non-main lists; main is pinned at absolute
  // index 0, so a section-2 position K maps to absolute index K + 1.
  const onReorder = (op: DndOp<NavList>) => {
    if (op.type !== "move") return;
    const ids = otherLists().map((l) => l.id);
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
    const offset = mainList() ? 1 : 0;
    const currentIds = [...ids];
    for (const [index, id] of nextIds.entries()) {
      if (currentIds[index] !== id) {
        const currentIndex = currentIds.indexOf(id);
        if (currentIndex < 0) continue;
        props.app.moveList(id, index + offset);
        currentIds.splice(currentIndex, 1);
        currentIds.splice(index, 0, id);
      }
    }
  };
  return (
    <nav class="nav">
      <div class="nav-group">
        <Show when={mainList()}>
          {(l) => (
            <button
              type="button"
              class="nav-item"
              data-active={
                props.view.kind === "list" && props.view.id === l().id ? "" : undefined
              }
              onClick={() => props.setView({ kind: "list", id: l().id })}
            >
              <EditableNavLabel
                name={l().name}
                onSave={(name) => props.app.renameList(l().id, name)}
              />
            </button>
          )}
        </Show>
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
          onClick={() => props.setView({ kind: "bin" })}
        >
          Bin
        </button>
      </div>
      <div class="nav-group">
        <Show when={otherLists().length > 0}>
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
          <form class="add-form" style={{ padding: "4px 12px" }} onSubmit={submit}>
            <input
              autofocus
              type="text"
              placeholder="List name"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onBlur={() => {
                if (!name().trim()) setAdding(false);
              }}
            />
          </form>
        </Show>
      </div>
    </nav>
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

function AddForm(props: { onAdd: (text: string) => void }) {
  const [text, setText] = createSignal("");
  const submit = (e: Event) => {
    e.preventDefault();
    const t = text().trim();
    if (!t) return;
    props.onAdd(t);
    setText("");
  };
  return (
    <form class="add-form" onSubmit={submit}>
      <input
        type="text"
        placeholder="Add an item…"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
      />
      <button type="submit">Add</button>
    </form>
  );
}

function Row(props: {
  item: () => ItemView;
  expanded: () => boolean;
  app: DocApp;
  selection: DndSelection;
}) {
  let textRef!: HTMLSpanElement;

  // Order matters: this effect must run *before* the model-mirror effect
  // below. On collapse, both fire in the same tick — if the mirror runs
  // first, it overwrites the user's edit with the stale model text and
  // we save nothing.
  createEffect(
    on(
      props.expanded,
      (now, prev) => {
        if (!prev && now) {
          queueMicrotask(() => {
            textRef.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(textRef);
            sel?.removeAllRanges();
            sel?.addRange(range);
          });
          return;
        }
        if (prev && !now) {
          const next = (textRef.textContent ?? "").trim();
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
      return it !== undefined && it.status !== "binned";
    });
  const onBin = () => {
    for (const id of binTargets()) props.app.setStatus(id, "binned");
  };
  const onMarkDone = () => {
    for (const id of targetIds()) {
      const it = props.app.getItem(id);
      if (it && it.status === "live") props.app.setStatus(id, "done");
    }
  };
  const onMarkNotDone = () => {
    for (const id of targetIds()) {
      const it = props.app.getItem(id);
      if (it && it.status === "done") props.app.setStatus(id, "live");
    }
  };
  const onRestore = () => {
    for (const id of targetIds()) {
      const it = props.app.getItem(id);
      if (it && it.status === "binned") props.app.setStatus(id, "live");
    }
  };
  const onDelete = () => {
    for (const id of targetIds()) {
      const it = props.app.getItem(id);
      if (it && it.status === "binned") props.app.deleteBinned(id);
    }
  };
  const onDuplicate = () => {
    const newIds: string[] = [];
    for (const id of targetIds()) {
      const it = props.app.getItem(id);
      if (!it || it.status !== "live") continue;
      const newId = props.app.duplicateItem(id);
      if (newId) newIds.push(newId);
    }
    if (newIds.length === 0) return;
    // Wait for the dnd's source to absorb the new ids before touching
    // selection — selection.updateOrder fires on source.onChange, and
    // selectOnly/addBlock on a key the order map doesn't yet know about
    // leaves it unselected visually.
    queueMicrotask(() => {
      props.selection.selectOnly(newIds[0]);
      for (let i = 1; i < newIds.length; i++) {
        props.selection.addBlock(newIds[i]);
      }
    });
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
        data-status={props.item().status}
        data-expanded={props.expanded() ? "" : undefined}
      >
        <input
          type="checkbox"
          checked={props.item().status === "done"}
          onChange={(e) =>
            props.app.setStatus(
              props.item().id,
              e.currentTarget.checked ? "done" : "live",
            )
          }
        />
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
              // triggers the save effect above.
              e.preventDefault();
              (e.currentTarget as HTMLElement).dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
              );
              return;
            }
            // Don't let the dnd intercept keys the contenteditable owns.
            if (e.key !== "Escape") e.stopPropagation();
          }}
        />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content class="context-menu-content">
          <Show when={props.item().status === "live"}>
            <ContextMenu.Item class="context-menu-item" onSelect={onMarkDone}>
              Mark as done
            </ContextMenu.Item>
            <ContextMenu.Item class="context-menu-item" onSelect={onDuplicate}>
              Duplicate
            </ContextMenu.Item>
          </Show>
          <Show when={props.item().status === "done"}>
            <ContextMenu.Item class="context-menu-item" onSelect={onMarkNotDone}>
              Mark as not done
            </ContextMenu.Item>
          </Show>
          <Show when={props.item().status !== "binned"}>
            <ContextMenu.Item class="context-menu-item" onSelect={onBin}>
              Move to bin
            </ContextMenu.Item>
          </Show>
          <Show when={props.item().status === "binned"}>
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
