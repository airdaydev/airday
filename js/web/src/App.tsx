// Top-level app. Login form gates the main UI; on success we open a
// Doc + SyncEngine and start the WebSocket pump. The post-login UI
// is the same shape as Stage 3's Doc-only build, but every read /
// mutation goes through the engine so peer ops apply live.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
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
import { Dnd, DndSelection, type DndOp } from "@primavera-ui/components/dnd/solid";
import { api } from "./api.ts";
import { dekVault } from "./dekVault.ts";
import { Login, type Session } from "./Login.tsx";
import {
  createSyncedApp,
  type DocApp,
  type ItemView,
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
      if (kind === "ops") app.tick();
    },
  });
  app.setOnFlush(() => bridge.pumpOutbox());
  bridge.start();
  onCleanup(() => bridge.stop());

  // Debounced persistence. Every doc change (local mutation or
  // remote apply) ticks `version`; we coalesce a window of 500ms and
  // write a fresh snapshot. The visibility-hidden listener is the
  // belt-and-suspenders save for tab-close.
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
  // Track version() so saves run on every doc change.
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
  const [view, setView] = createSignal<ViewKey>({ kind: "list", id: "now" });
  const [dndItems, setDndItems] = createSignal<ItemView[]>([]);
  const [themePref, setThemePref] = createSignal<ThemePreference>(theme.get());
  const snapshot = createMemo(() => app.snapshot());

  // One selection model per Workspace instance — the Dnd component is
  // re-keyed on view change (so it remounts), but we re-use the selection
  // object so consumers always read from the same handle. Stale block
  // anchors from the previous view's keys would resolve to position 0
  // (giving phantom selection at the top of the new list), so clear when
  // the view switches.
  const selection = new DndSelection();
  createEffect(on(view, () => selection.clear(), { defer: true }));

  const orderedIds = createMemo((): string[] => {
    const snap = snapshot();
    const v = view();
    if (v.kind === "list") return snap.liveIdsByList[v.id] ?? [];
    if (v.kind === "done") return snap.doneIds;
    return snap.binnedIds;
  });

  const items = createMemo((): ItemView[] => {
    const snap = snapshot();
    return orderedIds()
      .map((id) => snap.itemsById[id])
      .filter((item): item is ItemView => item !== undefined);
  });

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
    const ids = orderedIds();
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
    const listId = v.kind === "list" ? v.id : "now";
    app.addItem(listId, text);
  };

  return (
    <div class="app">
      <Nav app={app} lists={snapshot().lists} view={view()} setView={setView} />
      <main class="main">
        <header class="main-header">
          <h1>{viewTitle(view(), snapshot().lists)}</h1>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <span class="status" data-online={props.online ? "" : undefined}>
              {props.online ? "● online" : "○ offline"}
            </span>
            <span class="status" title={props.session.email}>
              {props.session.email}
            </span>
            <select
              class="theme-select"
              aria-label="Appearance"
              value={themePref()}
              onChange={(e) => {
                const pref = e.currentTarget.value as ThemePreference;
                setThemePref(pref);
                theme.set(pref);
              }}
            >
              <option value="auto">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <button type="button" onClick={() => props.logout()}>
              Log out
            </button>
            <Show when={view().kind === "bin" && snapshot().binnedIds.length > 0}>
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
            when={orderedIds().length > 0}
            fallback={<div class="empty">Nothing here yet.</div>}
          >
            <Show keyed when={dndRevision()}>
              <Dnd
                items={dndItems()}
                setItems={setDndItems}
                getKey={(it) => it.id}
                selection={selection}
                itemHeight={40}
                onReorder={onReorder}
                style={{ height: "100%", display: "block" }}
              >
                {(item) => <Row item={item} app={app} selection={selection} />}
              </Dnd>
            </Show>
          </Show>
        </div>
      </main>
    </div>
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
  return (
    <nav class="nav">
      <For each={props.lists}>
        {(l) => (
          <button
            type="button"
            class="nav-item"
            data-active={
              props.view.kind === "list" && props.view.id === l.id ? "" : undefined
            }
            onClick={() => props.setView({ kind: "list", id: l.id })}
          >
            {l.name}
          </button>
        )}
      </For>
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
    </nav>
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

function Row(props: { item: () => ItemView; app: DocApp; selection: DndSelection }) {
  // If the right-clicked row is already in the multi-select, act on the
  // whole selection; otherwise act on this row alone. The onOpenChange
  // hook below makes sure that an unselected row becomes the sole
  // selection before the menu actually opens.
  const binTargets = (): string[] => {
    const id = props.item().id;
    const ids = props.selection.isSelected(id)
      ? props.selection.getSelectedKeys().map(String)
      : [id];
    return ids.filter((k) => {
      const it = props.app.getItem(k);
      return it !== undefined && it.status !== "binned";
    });
  };
  const onBin = () => {
    for (const id of binTargets()) props.app.setStatus(id, "binned");
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
        <span class="row-text">{props.item().text}</span>
        <div class="row-actions">
          <Show when={props.item().status === "binned"}>
            <button type="button" onClick={() => props.app.setStatus(props.item().id, "live")}>
              Restore
            </button>
            <button type="button" onClick={() => props.app.deleteBinned(props.item().id)}>
              Delete
            </button>
          </Show>
          <Show when={props.item().status === "done"}>
            <button type="button" onClick={() => props.app.setStatus(props.item().id, "live")}>
              Undo
            </button>
          </Show>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content class="context-menu-content">
          <Show when={props.item().status !== "binned"}>
            <ContextMenu.Item class="context-menu-item" onSelect={onBin}>
              Bin
            </ContextMenu.Item>
          </Show>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
