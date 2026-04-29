// Top-level app. Login form gates the main UI; on success we open a
// Doc + SyncEngine and start the WebSocket pump. The post-login UI
// is the same shape as Stage 3's Doc-only build, but every read /
// mutation goes through the engine so peer ops apply live.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { Doc, EncryptedBlob, SyncEngine } from "@airday/core/wasm";
import { OpfsStorage } from "@airday/core";
import { DndSource, type DndOp } from "@primavera-ui/components/dnd";
import { Dnd } from "./Dnd.tsx";
import { Login, type Session } from "./Login.tsx";
import { createSyncedApp, type DocApp } from "./store.ts";
import { SyncBridge } from "./sync.ts";

type ViewKey =
  | { kind: "list"; id: string }
  | { kind: "done" }
  | { kind: "bin" };

const CLIENT_NAME = "airday-web";
const CLIENT_VERSION = "0.1.0";

export function App() {
  const [session, setSession] = createSignal<Session | null>(null);
  const [online, setOnline] = createSignal(false);
  const [boot, setBoot] = createSignal<{ doc: Doc; lastAcked: bigint } | null>(
    null,
  );
  const [bootError, setBootError] = createSignal<string | null>(null);

  return (
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
        />
      )}
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

  const storage = new OpfsStorage(
    props.session.accountId,
    dekForStorage,
    EncryptedBlob,
  );

  const bridge = new SyncBridge({
    engine,
    serverUrl: props.session.serverUrl,
    deviceToken: props.session.deviceToken,
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
          serverUrl: props.session.serverUrl,
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

  return <Workspace app={app} session={props.session} online={props.online} />;
}

function Workspace(props: { app: DocApp; session: Session; online: boolean }) {
  const app = props.app;
  const [view, setView] = createSignal<ViewKey>({ kind: "list", id: "current" });
  const lists = createMemo(() => app.allLists());

  const orderedIds = createMemo<string[]>(() => {
    const v = view();
    if (v.kind === "list") return app.liveItemIds(v.id);
    if (v.kind === "done") return app.doneItemIds();
    return app.binnedItemIds();
  });

  const sourceForView = createMemo<DndSource<{ id: string }>>(() => {
    view();
    return untrack(
      () =>
        new DndSource<{ id: string }>({
          getKey: (it) => it.id,
          getOrder: () => orderedIds(),
          getItem: (key) => ({ id: String(key) }),
        }),
    );
  });

  let prevSrc: DndSource<{ id: string }> | null = null;
  createEffect(() => {
    const ids = orderedIds();
    const src = sourceForView();
    if (src !== prevSrc) {
      prevSrc = src;
      return;
    }
    const txn = src.apply([{ type: "reset", keys: [...ids] }]);
    src._commitState(txn);
  });

  const onDndChange = (op: DndOp<{ id: string }>) => {
    if (op.type !== "move") return;
    const v = view();
    if (v.kind !== "list") return;
    const ids = orderedIds();
    for (const key of op.keys) {
      const target = ids.indexOf(String(key));
      if (target >= 0) app.moveItem(String(key), v.id, target);
    }
  };

  const addItem = (text: string) => {
    const v = view();
    const listId = v.kind === "list" ? v.id : "current";
    app.addItem(listId, text);
  };

  return (
    <div class="app">
      <Nav app={app} lists={lists()} view={view()} setView={setView} />
      <main class="main">
        <header class="main-header">
          <h1>{viewTitle(view(), lists())}</h1>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <span class="status" data-online={props.online ? "" : undefined}>
              {props.online ? "● online" : "○ offline"}
            </span>
            <Show when={view().kind === "bin" && app.binnedItemIds().length > 0}>
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
            <Dnd source={sourceForView()} itemHeight={40} onChange={onDndChange}>
              {(key) => <Row id={String(key)} app={app} />}
            </Dnd>
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
      <div class="nav-section">Lists</div>
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
      <div class="nav-section">Cross-list</div>
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

function Row(props: { id: string; app: DocApp }) {
  const item = createMemo(() => props.app.getItem(props.id));
  return (
    <Show when={item()}>
      {(it) => (
        <div class="row" data-status={it().status}>
          <input
            type="checkbox"
            checked={it().status === "done"}
            onChange={(e) =>
              props.app.setStatus(it().id, e.currentTarget.checked ? "done" : "live")
            }
          />
          <span class="row-text">{it().text}</span>
          <div class="row-actions">
            <Show when={it().status !== "binned"}>
              <button type="button" onClick={() => props.app.setStatus(it().id, "binned")}>
                Bin
              </button>
            </Show>
            <Show when={it().status === "binned"}>
              <button type="button" onClick={() => props.app.setStatus(it().id, "live")}>
                Restore
              </button>
              <button type="button" onClick={() => props.app.deleteBinned(it().id)}>
                Delete
              </button>
            </Show>
            <Show when={it().status === "done"}>
              <button type="button" onClick={() => props.app.setStatus(it().id, "live")}>
                Undo
              </button>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
