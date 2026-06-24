import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { ContextMenu } from "@kobalte/core/context-menu";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Popover } from "@kobalte/core/popover";
import { Dnd, DndSelection, type DndOp } from "./dnd/solid";
import arrowRightSvg from "./icons/arrow-right.svg?raw";
import checkSvg from "./icons/check.svg?raw";
import cloudSvg from "./icons/cloud.svg?raw";
import cloudOffSvg from "./icons/cloud-off.svg?raw";
import crumpledPaperSvg from "./icons/crumpled-paper.svg?raw";
import dotsVerticalSvg from "./icons/dots-vertical.svg?raw";
import externalLinkSvg from "./icons/external-link.svg?raw";
import { formatRelative } from "./format.tsx";
import { useAppI18n } from "./i18n.tsx";
import { AuthDialog, type Session } from "./Login.tsx";
import { pasteAsPlainText } from "./plainTextPaste.ts";
import type { ViewKey } from "./prefs.ts";
import type { DocApp } from "./sync/store.ts";

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
  const seqLabel = (): string => {
    props.app.version();
    return String(props.app.engine.lastContiguousSeq());
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
        <Show
          when={props.online}
          fallback={<span innerHTML={cloudOffSvg} />}
        >
          <span innerHTML={cloudSvg} />
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
          <div class="status-line status-muted">{m().nav.seqLabel(seqLabel())}</div>
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

export function Nav(props: {
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

  // "Export JSON": pretty-printed semantic dump (lists + items).
  // Readable in any editor and round-trips through Import JSON, but
  // lossy: CRDT history, ordering metadata, and undo-stack info aren't
  // here. (A lossless plaintext-snapshot export exists in the core —
  // `exportSnapshot` — but stays unexposed until a matching import lands.)
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

  // Hidden file input the "Import JSON" menu item triggers via .click().
  // Resetting `value` between picks is what lets the user choose the same
  // file twice in a row — without it the change event never fires the
  // second time.
  let importFileInput: HTMLInputElement | undefined;
  const onImportFilePicked = async (
    e: Event & { currentTarget: HTMLInputElement },
  ): Promise<void> => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const summary = props.app.importJson(text);
      alert(m().nav.importSucceeded(summary.itemsAdded, summary.listsAdded));
    } catch (err) {
      console.error("import json failed:", err);
      alert(m().nav.importFailed);
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
      <input
        ref={importFileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={onImportFilePicked}
      />
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
                  {/* Rename + Delete are single-list actions. Multi-select
                      previously only hosted the show/hide-counts toggle,
                      which now lives in Settings → General, so a
                      multi-selection has no per-list menu: gate the whole
                      Portal so right-clicking a multi-selection shows
                      nothing rather than an empty menu. */}
                  <Show when={!isMultiMenu()}>
                    <ContextMenu.Portal>
                      <ContextMenu.Content class="context-menu-content">
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
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </Show>
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
          <button
            type="button"
            class="signin-button"
            onClick={() => setAuthOpen(true)}
          >
            {m().auth.signIn}
          </button>
          <AuthDialog
            open={authOpen()}
            onOpenChange={setAuthOpen}
            onSession={handleSession}
          />
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
              <DropdownMenu.Item
                class="dropdown-menu-item"
                onSelect={() => downloadJson()}
              >
                {m().nav.exportJson}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="dropdown-menu-item"
                onSelect={() => {
                  // Defer past the menu close + focus-restore so the
                  // native file picker isn't fighting Kobalte for focus.
                  requestAnimationFrame(() => importFileInput?.click());
                }}
              >
                {m().nav.importJson}
              </DropdownMenu.Item>
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
                <span innerHTML={externalLinkSvg} />
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

export function EditableNavLabel(props: {
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
      on:paste={(e) => {
        if (!editing()) return;
        // Strip formatting: paste plain text only, matching the row-text
        // editor — the label saves `textContent`, so pasted HTML would
        // just look styled until the rename commits.
        pasteAsPlainText(e);
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
