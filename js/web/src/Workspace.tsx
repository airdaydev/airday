import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import {
  Dnd,
  DndSelection,
  type DndImperative,
  type DndOp,
} from "./dnd/solid";
import type { DndDragEventDetail } from "./dnd";
import { Popover } from "@kobalte/core/popover";
import { SegmentedControl } from "@kobalte/core/segmented-control";
import caretLeftSvg from "./icons/caret-left.svg?raw";
import cardStackSvg from "./icons/card-stack.svg?raw";
import listBulletSvg from "./icons/list-bullet.svg?raw";
import dotsVerticalSvg from "./icons/dots-vertical.svg?raw";
import menuSvg from "./icons/menu.svg?raw";
import plusSvg from "./icons/plus.svg?raw";
import trashSvg from "./icons/trash.svg?raw";
import { Board, type BoardImperative } from "./Board.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { DueCalendarDialog } from "./DueCalendarDialog.tsx";
import { FindPalette } from "./FindPalette.tsx";
import { useAppI18n } from "./i18n.tsx";
import { restoreCapturedPositions } from "./linger.ts";
import { EditableNavLabel, Nav, StatusSlot } from "./nav.tsx";
import { isOverlayOpen, onGlobalKey } from "./overlay.ts";
import type { ViewKey } from "./prefs.ts";
import { Row, DRAFT_ID_PREFIX } from "./Row.tsx";
import { planReorderMoves } from "./reorder.ts";
import type { SearchResult } from "./search.ts";
import { Settings } from "./Settings.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { TaskDialog } from "./TaskDialog.tsx";
import { useSession } from "./SessionContext.tsx";
import {
  isBinned,
  isDone,
  isInListView,
  type DocApp,
  type ItemView,
  type ListView,
} from "./sync/store.ts";
import { createTheme, type ThemePreference } from "./theme.ts";

// Done items linger in their live list this long after being marked
// done, so the user sees the strike-through before the row drops out.
// The state change is instant — this is purely a render-time tail
// derived from doneAt, not a separate "pending" set.
const DONE_LINGER_MS = 3_000;

// Module-level so the OS-preference listener is registered exactly
// once for the lifetime of the page.
const theme = createTheme();

// Per-list board-mode toggle. A purely local view preference (the same
// account may want a board on desktop and a flat list on a phone), so
// it lives in localStorage rather than the synced doc or the IDB prefs
// row — see spec/kanban.md "Client (web) contract".
const BOARD_PREF_KEY = "airday:board-lists";
function loadBoardPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(BOARD_PREF_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

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

export function Workspace(props: {
  app: DocApp;
  // View lives in `MainApp` so device writes can persist it alongside
  // the sync frontier in one debounced put. See `currentView` on
  // `DeviceConfig`.
  view: () => ViewKey;
  setView: (v: ViewKey) => void;
}) {
  const { m } = useAppI18n();
  const session = useSession();
  const app = props.app;
  const state = app.state;
  const view = props.view;
  const setView = props.setView;
  const [dndItems, setDndItems] = createSignal<ItemView[]>([]);
  const [themePref, setThemePref] = createSignal<ThemePreference>(theme.get());
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [emptyBinConfirmOpen, setEmptyBinConfirmOpen] = createSignal(false);
  const [findOpen, setFindOpen] = createSignal(false);
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
  // The item currently opened in the detail dialog, or null when closed.
  const [openItemId, setOpenItemId] = createSignal<string | null>(null);
  // Shared due-date calendar, opened from a row/board context menu's "Set
  // date". Holds the target item ids and the stamp to seed the calendar
  // with (the clicked row's current due date, or null); one modal serves
  // every row rather than mounting a Dialog per row.
  const [dueTarget, setDueTarget] = createSignal<{
    ids: readonly string[];
    initial: string | null;
  } | null>(null);
  const openDueCalendar = (ids: readonly string[], initial: string | null) => {
    if (ids.length > 0) setDueTarget({ ids, initial });
  };
  // New-item capture target for the detail dialog (board "+" buttons), or
  // null when not capturing. Mutually exclusive with `openItemId`.
  const [newItemTarget, setNewItemTarget] = createSignal<{
    listId: string;
    columnId: string | null;
    /** Linear live-projection index to insert at (Space capture below a
     *  selected board card, or at the top). Omitted for "+" captures,
     *  which append to the column. */
    index?: number;
  } | null>(null);
  // Ids to select + scroll into view in the board once they land in their
  // column (a "+" capture, a duplicated block, or a find-palette pick that
  // lands on a board list). A list so a multi-item duplicate selects the
  // whole block, not just one. Handed to the Board, which clears it once it
  // lands the selection.
  const [boardRevealIds, setBoardRevealIds] = createSignal<string[] | null>(
    null,
  );
  // The board's active column selection (or null), published up by Board so
  // the global item shortcuts act on it in board view — the workspace-level
  // `selection` below only ever holds the flat list view's selection.
  const [boardSelection, setBoardSelection] = createSignal<DndSelection | null>(
    null,
  );
  // UI-only mirror of the title being edited in the dialog: the list row
  // reflects it live while typing, but nothing is written to the engine
  // until the dialog flushes on close (so no op-per-keystroke). Cleared
  // whenever the dialog closes, via any path.
  const [liveEdit, setLiveEdit] = createSignal<{
    id: string;
    text: string;
  } | null>(null);
  // Which field the dialog focuses on open — the note badge opens to notes,
  // everything else to the title. Reset to title whenever the dialog closes.
  const [openFocus, setOpenFocus] = createSignal<"title" | "notes">("title");
  // Title caret offset for the dialog when opened by a double-click, so it
  // lands where the user pointed; null (→ caret at end) otherwise. Reset
  // whenever the dialog closes.
  const [openCaret, setOpenCaret] = createSignal<number | null>(null);
  // Which lists render as a board. Persisted per browser (not synced).
  const [boardLists, setBoardLists] = createSignal<Record<string, boolean>>(
    loadBoardPrefs(),
  );
  const boardListId = createMemo((): string | null => {
    const v = view();
    return v.kind === "list" && boardLists()[v.id] ? v.id : null;
  });
  const toggleBoard = (listId: string) => {
    const next = { ...boardLists(), [listId]: !boardLists()[listId] };
    if (!next[listId]) delete next[listId];
    setBoardLists(next);
    try {
      localStorage.setItem(BOARD_PREF_KEY, JSON.stringify(next));
    } catch {
      // Quota/private-mode failures just lose the preference.
    }
  };
  createEffect(() => {
    if (openItemId() === null) {
      setLiveEdit(null);
      setOpenFocus("title");
      setOpenCaret(null);
    }
  });
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
  const itemsMobileMq = window.matchMedia("(max-width: 768px) and (pointer: coarse)");
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

  // The selection the global item shortcuts act on: the board's active
  // column selection in board view (or null when nothing's selected there),
  // otherwise the flat list view's single selection. Handlers bail on null.
  const actionSelection = (): DndSelection | null =>
    boardListId() !== null ? boardSelection() : selection;

  // Linger group for the active list view: the unbroken chain of
  // recently-done items walking back from the latest click. A new
  // Done click within DONE_LINGER_MS of the previous extends the
  // whole chain, so a burst of clicks all leave together at the
  // latest's expiry; a click after a gap starts a fresh chain.
  // Sourced from the store's `recentDone` capture — the live
  // projection drops done items instantly, so this is the only record
  // of what just left (and where it sat, for the re-insert below).
  const lingerChain = createMemo(
    (): { ids: Set<string>; expiry: number } => {
      const v = view();
      if (v.kind !== "list") return { ids: new Set(), expiry: -Infinity };
      const done = app
        .recentDone()
        .filter((r) => {
          if (r.listId !== v.id) return false;
          const it = state.itemsById[r.id];
          return it !== undefined && isDone(it) && !isBinned(it);
        })
        .sort((a, b) => b.doneAt - a.doneAt);
      if (done.length === 0) return { ids: new Set(), expiry: -Infinity };
      const ids = new Set<string>();
      let prev = done[0].doneAt;
      for (const r of done) {
        if (prev - r.doneAt >= DONE_LINGER_MS) break;
        ids.add(r.id);
        prev = r.doneAt;
      }
      return { ids, expiry: done[0].doneAt + DONE_LINGER_MS };
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

  // Per-view item slice. A list view reads only its own
  // `state.listLive[id]` array, so mutations in other lists (or in
  // Done/Bin) never invalidate it; item field edits track per-item
  // paths independently of the ordering. Done/Bin scan `itemsById`
  // lazily — the scan only runs while that view is active, and no
  // list-view mutation path pays for it.
  const items = createMemo((): ItemView[] => {
    const v = view();
    if (v.kind === "list") {
      const out: ItemView[] = [];
      for (const id of state.listLive[v.id] ?? []) {
        const it = state.itemsById[id];
        if (it) out.push(it);
      }
      // Re-insert the linger group at the positions its rows vacated.
      // Each index was captured after earlier Done rows had already left
      // `listLive`, so replay the removals in reverse capture order to
      // reconstruct the original layout.
      lingerTick();
      const { ids: lingerIds, expiry } = lingerChain();
      if (Date.now() < expiry) {
        const captured: Array<{ index: number; value: ItemView }> = [];
        for (const r of app
          .recentDone()
          .filter((r) => r.listId === v.id && lingerIds.has(r.id))) {
          const it = state.itemsById[r.id];
          if (!it || !isDone(it) || isBinned(it)) continue;
          captured.push({ index: r.index, value: it });
        }
        restoreCapturedPositions(out, captured);
      }
      return out;
    }
    if (v.kind === "done") {
      // Done view excludes binned items: a done-then-binned item lives
      // in the Bin (see context menu — Bin owns the next transition).
      return Object.values(state.itemsById)
        .filter((it) => isDone(it) && !isBinned(it))
        .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    }
    return Object.values(state.itemsById)
      .filter(isBinned)
      .sort((a, b) => (b.binnedAt ?? 0) - (a.binnedAt ?? 0));
  });

  const lists = createMemo((): ListView[] =>
    state.listsOrder
      .map((id) => state.listsById[id])
      .filter((l): l is ListView => l !== undefined),
  );

  // Per-list live-item counts for the nav badge, read straight off the
  // per-list projection arrays — no item scan. (The bin badge reads the
  // store's maintained `state.binCount` directly.) Home's count always
  // renders; non-Home lists are gated by the doc-level `showListCounts`
  // flag.
  const liveCountsByList = createMemo((): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const [listId, ids] of Object.entries(state.listLive)) {
      counts[listId] = ids.length;
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
    const moves = planReorderMoves(
      ids,
      op.keys.map(String),
      op.beforeKey === null ? null : String(op.beforeKey),
    );
    if (moves.length === 0) return;
    app.withActionBatch(() => {
      for (const move of moves) {
        app.moveItem(move.id, v.id, move.index);
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
  const settleDraft = (text: string, chain: boolean) => {
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
    // Notes are no longer captured inline — a new item starts noteless and
    // the user adds notes later by opening it in the detail dialog.
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
    if (isOverlayOpen()) return;
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
    const sel = actionSelection();
    if (!sel) return;
    const v = view();
    const visibleIds = items().map((it) => it.id);
    const visibleSet = new Set(visibleIds);
    const ids = sel
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
    // The survivor is chosen in list order, which on the board may sit in a
    // different column than the active selection — so only re-select in the
    // flat list view; on the board just drop the (now-removed) selection.
    if (nextId === null || boardListId() !== null) {
      sel.clear();
    } else {
      const target = nextId;
      // Wait for the dnd source to absorb the removals before
      // selecting — matches onDuplicate/onPaste.
      queueMicrotask(() => sel.selectOnly(target));
    }
  };
  onGlobalKey(onDeleteKey);

  // x: toggle done on the current selection. Mirrors the row checkbox and
  // the context menu's Mark done / Mark not done. Skip when focus is in an
  // editable surface so a literal "x" typed into a row/AddForm lands as
  // text. Toggle direction follows the group: any not-done → mark all done,
  // only flip back to not-done when every selected item is already done.
  const onToggleDoneKey = (e: KeyboardEvent) => {
    if (e.key !== "x" && e.key !== "X") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const sel = actionSelection();
    if (!sel) return;
    const visibleSet = new Set(items().map((it) => it.id));
    const ids = sel
      .getSelectedKeys()
      .map(String)
      .filter((id) => visibleSet.has(id));
    if (ids.length === 0) return;
    e.preventDefault();
    const allDone = ids.every((id) => {
      const it = app.getItem(id);
      return it !== undefined && isDone(it);
    });
    app.setDoneMany(ids, !allDone);
  };
  onGlobalKey(onToggleDoneKey);

  // Duplicate live items as a contiguous block immediately after the
  // bottom-most source row — same shape as paste — rather than each
  // clone sitting under its own original. Shared by Cmd+D and the row
  // context menu's Duplicate action so both behave identically.
  const duplicateBlock = (sourceIds: readonly string[]): void => {
    const v = view();
    if (v.kind !== "list") return;
    const visible = items().map((it) => it.id);
    const sourceSet = new Set(sourceIds);
    // Only inherit a column register that actually resolves to a live column
    // of this list — a stale/default register is left off so the clone falls
    // to the default column (and `setItemColumn` never rejects an unknown id).
    const validCols = new Set(
      (state.columnsByList[v.id] ?? []).map((c) => c.id),
    );
    const sourcesInOrder: {
      idx: number;
      text: string;
      column: string | undefined;
    }[] = [];
    visible.forEach((id, idx) => {
      if (!sourceSet.has(id)) return;
      const it = app.getItem(id);
      if (!it || !isInListView(it)) return;
      const column =
        it.column && validCols.has(it.column) ? it.column : undefined;
      sourcesInOrder.push({ idx, text: it.text, column });
    });
    if (sourcesInOrder.length === 0) return;
    const insertAt = sourcesInOrder[sourcesInOrder.length - 1].idx + 1;
    const texts = sourcesInOrder.map((s) => s.text);
    // Create the block, then copy each source's (valid) column register onto
    // its clone in one undo step, so a dupe made inside a board column lands
    // in that column instead of the default one. setItemColumn with no index
    // keeps the clone's just-assigned linear position.
    const newIds = app.withActionBatch(() => {
      const ids = app.addItemsAt(v.id, texts, insertAt);
      ids.forEach((id, i) => {
        const col = sourcesInOrder[i]?.column;
        if (col) app.setItemColumn(id, col);
      });
      return ids;
    });
    if (newIds.length === 0) return;
    if (boardListId() !== null) {
      // On the board, hand the whole clone block to the reveal path so it
      // becomes the active column selection and scrolls into view.
      setBoardRevealIds(newIds);
      return;
    }
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
    const ids = actionSelection()?.getSelectedKeys().map(String) ?? [];
    if (ids.length === 0) return;
    e.preventDefault();
    duplicateBlock(ids);
  };
  onGlobalKey(onDuplicateKey);

  // Cmd/Ctrl+C: copy the current selection through copyBlock. Skipped
  // when focus is in an editable surface so the browser's native copy
  // still grabs the user's text fragment, and skipped when there's a
  // non-collapsed window selection (the user is copying highlighted
  // text, not rows).
  const onCopyKey = (e: KeyboardEvent) => {
    if (e.key !== "c" && e.key !== "C") return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    const winSel = window.getSelection();
    if (winSel && !winSel.isCollapsed && winSel.toString().length > 0) return;
    const ids = actionSelection()?.getSelectedKeys().map(String) ?? [];
    if (ids.length === 0) return;
    e.preventDefault();
    copyBlock(ids);
  };
  onGlobalKey(onCopyKey);

  // Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z (redo). Skipped when focus
  // is in an editable surface so the browser's native text-undo handles
  // mid-typing in inputs/textareas/contenteditable rows. Only swallows
  // the keystroke when the engine actually applied a step — otherwise
  // the OS / browser still gets a shot at it.
  const onUndoRedoKey = (e: KeyboardEvent) => {
    if (e.key !== "z" && e.key !== "Z") return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.altKey) return;
    const did = e.shiftKey ? app.redo() : app.undo();
    if (did) e.preventDefault();
  };
  onGlobalKey(onUndoRedoKey);

  let dndHandle: DndImperative | null = null;
  let boardHandle: BoardImperative | null = null;
  // Restore keyboard focus after the detail dialog closes: the board (many
  // column listboxes) and the list view (one) each expose their own handle;
  // only one is mounted at a time.
  const restoreItemsFocus = () => {
    if (boardListId() !== null) boardHandle?.focusActive();
    else dndHandle?.focus();
  };

  // Enter: open the topmost selected item in the detail dialog. The dialog
  // owns Enter while open (commits & closes), and onGlobalKey's overlay /
  // editable-surface guards keep this from firing there.
  const onOpenKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const sel = actionSelection();
    const top = sel?.getSelectionTop() ?? null;
    if (top === null) return;
    e.preventDefault();
    setOpenItemId(String(top));
  };
  onGlobalKey(onOpenKey);

  // Cmd/Ctrl+Enter: inline "quick edit" — expand the topmost selected row for
  // editing, or collapse the expanded row (collapse runs the save effect in
  // Row). The expanded row's contenteditable owns Enter while editing — it
  // dispatches an Escape to drive collapse — so the editable-surface guard
  // keeps us from double-handling there.
  const onQuickEdit = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.altKey || e.shiftKey) return;
    // List-view only: the board has no inline edit and `dndHandle` points at
    // the (now-unmounted) list Dnd while a board is showing.
    if (boardListId() !== null) return;
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
  onGlobalKey(onQuickEdit);

  // ? opens the keyboard-shortcut cheat sheet. `?` is Shift+/, so shift is
  // expected; bail on the other modifiers. onGlobalKey already skips it
  // while typing or when another overlay is open.
  const onHelpKey = (e: KeyboardEvent) => {
    if (e.key !== "?") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    setShortcutsOpen(true);
  };
  onGlobalKey(onHelpKey);

  // Space: shortcut for the Add button. In the list view it starts an
  // inline draft below the topmost selection. In a board it opens the
  // new-item dialog (boards capture via the dialog, not an inline draft),
  // placing the new card just below the selected card in its column — or
  // at the top of the default column when nothing is selected.
  const onSpaceAdd = (e: KeyboardEvent) => {
    if (e.key !== " ") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (view().kind !== "list") return;

    const boardId = boardListId();
    if (boardId !== null) {
      e.preventDefault();
      const top = actionSelection()?.getSelectionTop() ?? null;
      const anchor = top !== null ? app.getItem(String(top)) : undefined;
      if (anchor && isInListView(anchor)) {
        // Below the selected card, in its resolved column. A register
        // naming a deleted column falls back to the default column so the
        // core's find_column check can't reject it.
        const cols = app.state.columnsByList[boardId] ?? [];
        const columnId =
          anchor.column && cols.some((c) => c.id === anchor.column)
            ? anchor.column
            : null;
        const linear = app.state.listLive[boardId] ?? [];
        const at = linear.indexOf(anchor.id);
        setNewItemTarget({
          listId: boardId,
          columnId,
          index: at >= 0 ? at + 1 : 0,
        });
      } else {
        // Nothing selected: top of the default column.
        setNewItemTarget({ listId: boardId, columnId: null, index: 0 });
      }
      return;
    }

    if (draft() !== null) return;
    e.preventDefault();
    startDraft();
  };
  onGlobalKey(onSpaceAdd);

  // [ / ]: cycle through the nav views in top-to-bottom order — Home, Done,
  // Bin, then the user lists (Bin only earns a slot while it holds items,
  // matching its nav visibility). Wraps at both ends. From a view that
  // isn't in the sequence (e.g. an emptied Bin), ] enters at the top and
  // [ at the bottom, so the bracket pair always re-enters the set.
  const viewKey = (v: ViewKey) => (v.kind === "list" ? `list:${v.id}` : v.kind);
  const onBracketNavigate = (e: KeyboardEvent) => {
    if (e.key !== "[" && e.key !== "]") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const seq: ViewKey[] = [
      { kind: "list", id: "main" },
      { kind: "done" },
      ...(state.binCount > 0 ? [{ kind: "bin" } as ViewKey] : []),
      ...lists().map((l): ViewKey => ({ kind: "list", id: l.id })),
    ];
    const idx = seq.findIndex((s) => viewKey(s) === viewKey(view()));
    const step = e.key === "]" ? 1 : -1;
    const nextIdx =
      idx === -1
        ? step === 1
          ? 0
          : seq.length - 1
        : (idx + step + seq.length) % seq.length;
    e.preventDefault();
    setView(seq[nextIdx]!);
  };
  onGlobalKey(onBracketNavigate);

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
  // Classify via `firstItem` — `detail.items` is a lazy getter over the
  // whole dragged selection, and this runs on every pointermove.
  const isItemDrag = (detail: DndDragEventDetail): boolean => {
    const first = detail.firstItem;
    return typeof first === "object" && first !== null && "listId" in first;
  };

  const onDndDragMove = (e: Event) => {
    const ce = e as CustomEvent<DndDragEventDetail>;
    if (!isItemDrag(ce.detail)) return;
    clearDropHighlight();
    const target = findDropTarget(ce.detail.x, ce.detail.y);
    if (target) target.el.dataset.dropActive = "";
  };
  const onDndDragEnd = (e: Event) => {
    const ce = e as CustomEvent<DndDragEventDetail>;
    clearDropHighlight();
    if (!isItemDrag(ce.detail)) return;
    const target = findDropTarget(ce.detail.x, ce.detail.y);
    if (!target) return;
    ce.preventDefault();
    const draggedKeys = new Set(ce.detail.keys.map(String));
    // Sort by the source view's visible order so multi-select drops
    // preserve the user's visible ordering rather than landing in
    // selection order. Dragged rows always come from the active view.
    const idsInOrder = items()
      .map((it) => it.id)
      .filter((id) => draggedKeys.has(id));
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
    // If the destination list renders as a board, the list-view Dnd isn't
    // mounted — hand the id to the Board's reveal path (select + scroll in
    // the resolved column) instead of the list-view scroll below.
    if (target.kind === "list" && boardLists()[target.id]) {
      setBoardRevealIds([r.id]);
      return;
    }
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

  // Mobile drawer: at narrow viewports the nav and main panes each fill
  // the viewport and only one shows at a time (full-screen drawer — see
  // styles.css). `navOpen` is the only state; the FAB caret opens it,
  // tapping a list / Escape closes it.
  const mobileMq = window.matchMedia("(max-width: 768px) and (pointer: coarse)");
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
        binCount={state.binCount}
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
        session={session.session()}
        online={session.online()}
        lastSyncAt={session.lastSyncAt()}
        logout={session.logout}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onSession={session.swapSession}
        isMobile={isMobile()}
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
        showListCounts={state.settings.showListCounts}
        onShowListCountsChange={(show) => app.setShowListCounts(show)}
        session={session.session()}
        logout={session.logout}
      />
      <ConfirmDialog
        open={emptyBinConfirmOpen()}
        onOpenChange={setEmptyBinConfirmOpen}
        message={m().workspace.emptyBinConfirm}
        confirmLabel={m().workspace.emptyBin}
        onConfirm={() => app.emptyBin()}
      />
      <TaskDialog
        itemId={openItemId}
        setItemId={setOpenItemId}
        newItem={newItemTarget}
        setNewItem={setNewItemTarget}
        app={app}
        homeName={homeName}
        lists={lists}
        focusField={openFocus}
        caret={openCaret}
        onClosed={restoreItemsFocus}
        onLiveText={(text) => {
          const id = openItemId();
          if (id) setLiveEdit({ id, text });
        }}
        onCreated={(id) => {
          // Only board view has a card to reveal; list-view capture keeps
          // its own draft/focus flow.
          if (boardListId() !== null) setBoardRevealIds([id]);
        }}
      />
      <DueCalendarDialog
        open={() => dueTarget() !== null}
        setOpen={(o) => {
          if (!o) setDueTarget(null);
        }}
        value={() => dueTarget()?.initial ?? null}
        onPick={(stamp) => {
          const t = dueTarget();
          if (t) for (const id of t.ids) app.setItemDueOn(id, stamp);
        }}
        onRemove={() => {
          const t = dueTarget();
          if (t) for (const id of t.ids) app.setItemDueOn(id, null);
        }}
      />
      <ShortcutsDialog
        open={shortcutsOpen()}
        onOpenChange={setShortcutsOpen}
      />
      <div class="content">
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
                onClick={() => setEmptyBinConfirmOpen(true)}
              >
                <span class="add-button-icon" innerHTML={trashSvg} />
                <span>{m().workspace.emptyBin}</span>
              </button>
            </Show>
            <Show when={view().kind === "list"}>
              <Popover placement="bottom-end" gutter={6}>
                <Popover.Trigger
                  class="add-button view-mode-trigger"
                  aria-label={
                    boardListId() !== null
                      ? m().board.viewAsBoard
                      : m().board.viewAsList
                  }
                  innerHTML={dotsVerticalSvg}
                />
                <Popover.Portal>
                  <Popover.Content class="view-mode-popover">
                    <SegmentedControl
                      class="theme-segmented"
                      aria-label={m().board.viewMode}
                      value={boardListId() !== null ? "board" : "list"}
                      onChange={(value) => {
                        const v = view();
                        if (v.kind !== "list") return;
                        const wantBoard = value === "board";
                        if (wantBoard !== (boardListId() !== null)) {
                          toggleBoard(v.id);
                        }
                      }}
                    >
                      <SegmentedControl.Indicator class="theme-segment-indicator" />
                      <SegmentedControl.Item value="list" class="theme-segment">
                        <SegmentedControl.ItemInput />
                        <SegmentedControl.ItemControl class="theme-segment-control">
                          <SegmentedControl.ItemLabel class="view-mode-label">
                            <span
                              class="view-mode-icon"
                              aria-hidden="true"
                              innerHTML={listBulletSvg}
                            />
                            <span>{m().board.list}</span>
                          </SegmentedControl.ItemLabel>
                        </SegmentedControl.ItemControl>
                      </SegmentedControl.Item>
                      <SegmentedControl.Item value="board" class="theme-segment">
                        <SegmentedControl.ItemInput />
                        <SegmentedControl.ItemControl class="theme-segment-control">
                          <SegmentedControl.ItemLabel class="view-mode-label">
                            <span
                              class="view-mode-icon"
                              aria-hidden="true"
                              innerHTML={cardStackSvg}
                            />
                            <span>{m().board.board}</span>
                          </SegmentedControl.ItemLabel>
                        </SegmentedControl.ItemControl>
                      </SegmentedControl.Item>
                    </SegmentedControl>
                  </Popover.Content>
                </Popover.Portal>
              </Popover>
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
                  const boardId = boardListId();
                  if (boardId !== null) {
                    // Board view has no inline draft flow; capture a new item
                    // into the implicit default column (top of the list),
                    // mirroring the board's own default-column "+".
                    setNewItemTarget({ listId: boardId, columnId: null });
                  } else {
                    startDraft();
                  }
                }}
                disabled={boardListId() === null && draft() !== null}
                aria-label={m().common.add}
              >
                <span class="add-button-icon" innerHTML={plusSvg} />
              </button>
            </Show>
          </div>
        </header>
        <Show
          keyed
          when={boardListId()}
          fallback={
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
                  autofocus
                  reorder={view().kind === "list"}
                  onReorder={onReorder}
                >
                  {(item, expanded) => {
                    // Overlay the dialog's in-progress title onto its row so the
                    // list mirrors the edit live. Only the edited row's object is
                    // swapped (others pass through by reference); the list is
                    // virtualized, so this recomputes for visible rows only.
                    const shownItem = createMemo(() => {
                      const ov = liveEdit();
                      const it = item();
                      return ov && ov.id === it.id ? { ...it, text: ov.text } : it;
                    });
                    return (
                      <Row
                        item={shownItem}
                        expanded={expanded}
                        app={app}
                        selection={selection}
                        viewKind={view().kind}
                        duplicateBlock={duplicateBlock}
                        copyBlock={copyBlock}
                        onDraftSettle={settleDraft}
                        onOpen={(id, focus, caret) => {
                          if (focus) setOpenFocus(focus);
                          if (caret != null) setOpenCaret(caret);
                          setOpenItemId(id);
                        }}
                        onSetDue={openDueCalendar}
                        openOnTap={itemsIsMobile}
                      />
                    );
                  }}
                </Dnd>
              </Show>
            </Show>
          }
        >
          {(listId) => (
            <Board
              app={app}
              listId={listId}
              onOpen={(id, focus, caret) => {
                if (focus) setOpenFocus(focus);
                if (caret != null) setOpenCaret(caret);
                setOpenItemId(id);
              }}
              onSetDue={openDueCalendar}
              openOnTap={itemsIsMobile}
              duplicateBlock={duplicateBlock}
              copyBlock={copyBlock}
              onAddItem={(listId, columnId) =>
                setNewItemTarget({ listId, columnId })
              }
              revealIds={boardRevealIds}
              clearReveal={() => setBoardRevealIds(null)}
              onActiveSelectionChange={setBoardSelection}
              ref={(h) => (boardHandle = h)}
            />
          )}
        </Show>
        {/* Mobile-only floating action buttons, fixed to the viewport.
            They sit inside .main, so opening the full-screen drawer hides
            them along with main (see styles.css). */}
        <button
          type="button"
          class="fab fab-back"
          aria-label={m().common.menu}
          onClick={() => setNavOpen(true)}
          innerHTML={caretLeftSvg}
        />
        <Show when={view().kind === "list" && boardListId() === null}>
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
      {/* Desktop-only footer strip below the main surface; the account /
          sync widget sits at its far right. On mobile this is hidden and
          the widget lives in the nav drawer's footer instead. */}
      <footer class="footer">
        <Show when={!isMobile()}>
          <StatusSlot
            app={app}
            online={session.online()}
            lastSyncAt={session.lastSyncAt()}
            session={session.session()}
            onSession={session.swapSession}
          />
        </Show>
      </footer>
      </div>
    </div>
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
