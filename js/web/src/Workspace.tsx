import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import {
  Dnd,
  DndSelection,
  type DndImperative,
  type DndOp,
} from "./dnd/solid";
import type { DndDragEventDetail } from "./dnd";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Popover } from "@kobalte/core/popover";
import { SegmentedControl } from "@kobalte/core/segmented-control";
import { Switch } from "@kobalte/core/switch";
import { Tooltip } from "@kobalte/core/tooltip";
import archiveSvg from "./icons/archive.svg?raw";
import cardStackSvg from "./icons/card-stack.svg?raw";
import checkSvg from "./icons/check.svg?raw";
import crumpledPaperSvg from "./icons/crumpled-paper.svg?raw";
import dotsHorizontalSvg from "./icons/dots-horizontal.svg?raw";
import drawingPinSvg from "./icons/drawing-pin.svg?raw";
import eyeNoneSvg from "./icons/eye-none.svg?raw";
import eyeOpenSvg from "./icons/eye-open.svg?raw";
import listBulletSvg from "./icons/list-bullet.svg?raw";
import mixerHzSvg from "./icons/mixer-hz.svg?raw";
import plusSvg from "./icons/card-stack-plus.svg?raw";
import trashSvg from "./icons/trash.svg?raw";
import { Board, laneLabel, type BoardImperative } from "./Board.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Deadlines } from "./Deadlines.tsx";
import { DeadlineCalendarDialog } from "./DeadlineCalendarDialog.tsx";
import { FindPalette } from "./FindPalette.tsx";
import { FindSheet } from "./FindSheet.tsx";
import type { FindResult } from "./findResults.tsx";
import { useAppI18n } from "./i18n.tsx";
import { ListIconPicker } from "./ListIconPicker.tsx";
import { restoreCapturedPositions } from "./linger.ts";
import { createPopoverTooltipGuard } from "./popoverTooltip.ts";
import type { ListOption } from "./ListPicker.tsx";
import { MovePalette } from "./MovePalette.tsx";
import { EditableNavLabel, Nav, NavMenu, StatusSlot } from "./nav.tsx";
import { MobileBars } from "./MobileShell.tsx";
import { digitNavTarget } from "./navShortcuts.ts";
import { isOverlayOpen, onGlobalKey } from "./overlay.ts";
import type { ViewKey } from "./prefs.ts";
import { Row, DRAFT_ID_PREFIX } from "./Row.tsx";
import { planReorderMoves } from "./reorder.ts";
import { Settings } from "./Settings.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { TaskDialog } from "./TaskDialog.tsx";
import { useSession } from "./SessionContext.tsx";
import {
  isBinned,
  isDone,
  isOpen,
  OPEN_STATES,
  type DocApp,
  type ItemView,
  type ListView,
  type RecentDoneEntry,
  type WorkflowState,
} from "./sync/store.ts";
import { rowHeight } from "./density.ts";
import { createTheme, type ThemePreference } from "./theme.ts";
import {
  encodeView,
  LIST_VIEW,
  parseView,
  viewsEqual,
  type ViewSpec,
} from "./view.ts";

// Done items linger in their live list this long after being marked
// done, so the user sees the strike-through before the row drops out.
// The state change is instant — this is purely a render-time tail
// derived from doneAt, not a separate "pending" set.
const DONE_LINGER_MS = 3_000;

// Module-level so the OS-preference listener is registered exactly
// once for the lifetime of the page.
const theme = createTheme();

// Per-list *local* view override: list ⇄ board plus the board's Done
// lane, for the lists where this browser wants something other than the
// list's saved default (the same account may want a board on desktop and
// a flat list on a phone — see spec/board.md "Client (web) contract").
// Absent ≡ follow the synced default; only genuinely divergent lists get
// a key, so a client that never overrides anything tracks the account.
// Values are encoded `ViewSpec` strings — the same grammar the doc
// stores, so comparing local against default is a string compare.
const VIEW_PREF_KEY = "airday:list-view";
function loadViewPrefs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(VIEW_PREF_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// Per-list *local* open-lane visibility for the board (spec/board.md
// "Lane visibility"): which of the four open lanes this browser renders.
// Client-local and display-only — hiding never mutates the doc and never
// syncs (the Done lane's bit is the one exception, riding the saved view
// as "board:nodone"). Absent ≡ all four lanes; only lists with hidden
// lanes get a key, stored as the *visible* lane names in ladder order.
const LANES_PREF_KEY = "airday:board-lanes";
/** One lane in the view-mode popover: name, item count, and an eye
 *  button toggling client-local visibility (spec/board.md "Lane
 *  visibility"). Hidden lanes dim so the icon state needn't be read
 *  closely. Only the eye is interactive for now. */
function LaneRow(props: {
  name: string;
  count: number;
  visible: boolean;
  onToggle: (show: boolean) => void;
}) {
  const { m } = useAppI18n();
  return (
    <div class="lane-row" data-hidden={props.visible ? undefined : ""}>
      <span class="lane-row-name">{props.name}</span>
      <span class="lane-row-count">{props.count}</span>
      <button
        type="button"
        class="lane-row-eye"
        aria-pressed={props.visible}
        aria-label={
          props.visible
            ? m().board.hideLane(props.name)
            : m().board.showLane(props.name)
        }
        onClick={() => props.onToggle(!props.visible)}
        innerHTML={props.visible ? eyeOpenSvg : eyeNoneSvg}
      />
    </div>
  );
}

function loadLanePrefs(): Record<string, WorkflowState[]> {
  try {
    const raw = localStorage.getItem(LANES_PREF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, WorkflowState[]> = {};
    for (const [listId, lanes] of Object.entries(parsed)) {
      if (!Array.isArray(lanes)) continue;
      const visible = OPEN_STATES.filter((s) => lanes.includes(s));
      if (visible.length > 0 && visible.length < OPEN_STATES.length) {
        out[listId] = visible;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// Global (not per-list) "show the origin-list badge on the Done view"
// preference. The Done view is a single global view, so this is one flag,
// not a per-list map. Same local-only storage rationale as the board prefs.
// On by default — only the "off" state is persisted (stored as "0").
const DONE_SHOW_LIST_PREF_KEY = "airday:done-show-list";
function loadDoneShowListPref(): boolean {
  try {
    return localStorage.getItem(DONE_SHOW_LIST_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

// Same origin-list badge flag for the Focus lens, which is also a single
// global view. Off by default — only the "on" state is persisted
// (stored as "1").
const FOCUS_SHOW_LIST_PREF_KEY = "airday:focus-show-list";
function loadFocusShowListPref(): boolean {
  try {
    return localStorage.getItem(FOCUS_SHOW_LIST_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

// Desktop "sidebar hidden" flag. Local-only chrome state like the prefs
// above; visible is the default, so only the hidden state is persisted
// (stored as "1"). Mobile ignores it — the drawer has its own state.
const NAV_HIDDEN_PREF_KEY = "airday:nav-hidden";
const DEADLINES_OPEN_PREF_KEY = "airday:deadlines-open";
function loadNavHiddenPref(): boolean {
  try {
    return localStorage.getItem(NAV_HIDDEN_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function loadDeadlinesOpenPref(): boolean {
  try {
    return localStorage.getItem(DEADLINES_OPEN_PREF_KEY) === "1";
  } catch {
    return false;
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

/** The header's "Display options" popover: tooltip on the trigger, popover
    body from children. The guard keeps the tooltip from showing while the
    popover is open (or when focus returns to the button on close). */
function DisplayOptionsPopover(props: { children: JSX.Element }) {
  const { m } = useAppI18n();
  const guard = createPopoverTooltipGuard();
  return (
    <Popover {...guard.popover} placement="bottom-end" gutter={6}>
      <Tooltip {...guard.tooltip} openDelay={200} closeDelay={0} placement="bottom">
        <Tooltip.Trigger
          as={Popover.Trigger}
          class="add-button view-mode-trigger"
          tabIndex={-1}
          aria-label={m().workspace.displayOptions}
          innerHTML={mixerHzSvg}
        />
        <Tooltip.Portal>
          <Tooltip.Content class="tooltip-content">
            {m().workspace.displayOptions}
            <Tooltip.Arrow />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content {...guard.content} class="view-mode-popover">
          {props.children}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
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
  // Rows the move palette will re-file (visible order), or null when the
  // palette is closed. Captured at open (from the `m` shortcut's selection
  // or a row context menu's target set) so the pick acts on what the user
  // saw, not on whatever the selection is by commit time.
  const [moveIds, setMoveIds] = createSignal<string[] | null>(null);
  // Shared deadline calendar, opened from a row/board context menu's "Set
  // date". Holds the target item ids and the stamp to seed the calendar
  // with (the clicked row's current deadline, or null); one modal serves
  // every row rather than mounting a Dialog per row.
  const [deadlineTarget, setDeadlineTarget] = createSignal<{
    ids: readonly string[];
    initial: string | null;
  } | null>(null);
  const openDeadlineCalendar = (ids: readonly string[], initial: string | null) => {
    if (ids.length > 0) setDeadlineTarget({ ids, initial });
  };
  // New-item capture target for the detail dialog (board "+" buttons), or
  // null when not capturing. Mutually exclusive with `openItemId`.
  const [newItemTarget, setNewItemTarget] = createSignal<{
    listId: string;
    /** Which open board lane to capture into (`backlog` is also the list
     *  view's default). */
    state: WorkflowState;
    /** Open-projection index to insert at (Space capture below a selected
     *  board card, or at the top). Omitted for "+" captures, which append
     *  to the lane. */
    index?: number;
    /** Log a directly-completed item: created open, then marked done on
     *  commit (the Done lane "+" and the Done view's "Log" button). The
     *  modal shows a checked box the user can flip back off. */
    done?: boolean;
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
  // Lists this browser renders differently from their saved default.
  // Persisted per browser (not synced); absent ≡ follow the default.
  const [viewOverrides, setViewOverrides] = createSignal<Record<string, string>>(
    loadViewPrefs(),
  );
  // The list's saved default view, or null when none is saved. Inbox has
  // no ListMeta row, so its default lives in the doc-level settings.
  const savedView = (listId: string): ViewSpec | null =>
    parseView(
      listId === "inbox"
        ? state.settings.inboxView
        : state.listsById[listId]?.defaultView,
    );
  // What this client actually renders: local override, else the synced
  // default, else the built-in flat list.
  const listView = (listId: string): ViewSpec =>
    parseView(viewOverrides()[listId]) ?? savedView(listId) ?? LIST_VIEW;
  const boardListId = createMemo((): string | null => {
    const v = view();
    return v.kind === "list" && listView(v.id).board ? v.id : null;
  });
  // The list currently on screen (board or flat), or null in Focus /
  // Done / Bin — the view-mode popover's subject.
  const currentListId = createMemo((): string | null => {
    const v = view();
    return v.kind === "list" ? v.id : null;
  });
  // Whether what this client renders is already the list's saved default
  // (so "save as default" would be a no-op).
  const isSavedDefault = (listId: string): boolean => {
    const saved = savedView(listId);
    return saved !== null && viewsEqual(listView(listId), saved);
  };
  const putViewOverrides = (map: Record<string, string>) => {
    setViewOverrides(map);
    try {
      localStorage.setItem(VIEW_PREF_KEY, JSON.stringify(map));
    } catch {
      // Quota/private-mode failures just lose the preference.
    }
  };
  // Record a local view choice. A choice that matches what this client
  // would render anyway drops the override instead of pinning it, so the
  // client keeps following the default if another device changes it.
  const setLocalView = (listId: string, next: ViewSpec) => {
    const map = { ...viewOverrides() };
    if (viewsEqual(next, savedView(listId) ?? LIST_VIEW)) delete map[listId];
    else map[listId] = encodeView(next);
    putViewOverrides(map);
  };
  const toggleBoard = (listId: string) => {
    const cur = listView(listId);
    setLocalView(listId, { ...cur, board: !cur.board });
  };
  const showDoneColumn = (listId: string): boolean => listView(listId).showDone;
  const setShowDoneColumn = (listId: string, show: boolean) => {
    // At least one lane must stay visible (spec/board.md "Lane
    // visibility"): refuse to hide Done while it is the only lane left.
    if (!show && visibleOpenLanes(listId).length === 0) return;
    setLocalView(listId, { ...listView(listId), showDone: show });
  };

  // Client-local open-lane visibility per list (spec/board.md "Lane
  // visibility"). Display-only: hiding never mutates the doc, and a
  // hidden lane simply doesn't render (so it is not a drop target).
  const [lanePrefs, setLanePrefs] = createSignal<Record<string, WorkflowState[]>>(
    loadLanePrefs(),
  );
  const visibleOpenLanes = (listId: string): WorkflowState[] =>
    lanePrefs()[listId] ?? [...OPEN_STATES];
  const setLaneVisible = (listId: string, lane: WorkflowState, show: boolean) => {
    const cur = visibleOpenLanes(listId);
    const next = show
      ? OPEN_STATES.filter((s) => s === lane || cur.includes(s))
      : cur.filter((s) => s !== lane);
    // At least one lane always renders: refuse to hide the last open
    // lane unless the Done lane is still on.
    if (next.length === 0 && !showDoneColumn(listId)) return;
    const map = { ...lanePrefs() };
    if (next.length === OPEN_STATES.length) delete map[listId];
    else map[listId] = next;
    setLanePrefs(map);
    try {
      localStorage.setItem(LANES_PREF_KEY, JSON.stringify(map));
    } catch {
      // Quota/private-mode failures just lose the preference.
    }
  };
  // Per-lane item counts for the board whose view-mode popover is open,
  // shown beside each lane toggle so hiding a lane is an informed choice.
  // Mirrors Board.tsx laneMembers / doneMembers: open items partitioned
  // by workflow state, plus this list's done-not-binned items. Empty
  // (all zero) while no board is mounted.
  const boardLaneCounts = createMemo((): Record<WorkflowState, number> => {
    const counts: Record<WorkflowState, number> = {
      backlog: 0,
      todo: 0,
      in_progress: 0,
      review: 0,
      done: 0,
    };
    const listId = boardListId();
    if (listId === null) return counts;
    for (const id of state.listOpen[listId] ?? []) {
      const it = state.itemsById[id];
      if (it) counts[it.state]++;
    }
    for (const it of Object.values(state.itemsById)) {
      if (it.listId === listId && isDone(it) && !isBinned(it)) counts.done++;
    }
    return counts;
  });
  // Default capture lane for a board: its first visible open lane
  // (Backlog unless hidden), falling back to Backlog when only the Done
  // lane renders.
  const defaultCaptureLane = (listId: string): WorkflowState =>
    visibleOpenLanes(listId)[0] ?? "backlog";
  // Save what this client is looking at as the list's default view for
  // every device, and drop the local override so this client follows the
  // default it just set.
  const saveViewAsDefault = (listId: string) => {
    app.setDefaultView(listId, encodeView(listView(listId)));
    const map = { ...viewOverrides() };
    delete map[listId];
    putViewOverrides(map);
  };
  // Whether the global Done view badges each item with its origin list.
  const [doneShowList, setDoneShowListSignal] = createSignal<boolean>(
    loadDoneShowListPref(),
  );
  const setDoneShowList = (show: boolean) => {
    setDoneShowListSignal(show);
    try {
      if (show) localStorage.removeItem(DONE_SHOW_LIST_PREF_KEY);
      else localStorage.setItem(DONE_SHOW_LIST_PREF_KEY, "0");
    } catch {
      // Quota/private-mode failures just lose the preference.
    }
  };
  // Whether the Focus lens badges each item with its origin list.
  const [focusShowList, setFocusShowListSignal] = createSignal<boolean>(
    loadFocusShowListPref(),
  );
  const setFocusShowList = (show: boolean) => {
    setFocusShowListSignal(show);
    try {
      if (show) localStorage.setItem(FOCUS_SHOW_LIST_PREF_KEY, "1");
      else localStorage.removeItem(FOCUS_SHOW_LIST_PREF_KEY);
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
    // Focus-lens capture: the item is created in `listId` (the inbox) and
    // simultaneously pinned into Focus at `insertIndex` (a *focus* slot,
    // not a list slot). Plain list drafts leave this false.
    focus?: boolean;
  } | null>(null);
  const [expandedKey, setExpandedKey] = createSignal<string | null>(null);

  // Touch viewports get taller rows so each item's a comfortable tap
  // target (the desktop height is too tight for a thumb). Row height
  // also follows the density preference (see density.ts). Dnd's cfg()
  // reads itemHeight reactively via setConfig, so flipping either
  // signal live-updates the controller.
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

  // Linger group for the active list or Focus view: the unbroken chain of
  // recently-done items walking back from the latest click. A new
  // Done click within DONE_LINGER_MS of the previous extends the
  // whole chain, so a burst of clicks all leave together at the
  // latest's expiry; a click after a gap starts a fresh chain.
  // Sourced from the store's `recentDone` capture — the live
  // projection drops done items instantly, so this is the only record
  // of what just left (and where it sat, for the re-insert below).
  // A capture belongs to the current view if it left this list (list
  // view) or held a Focus slot (Focus lens).
  const lingerMatches = (r: RecentDoneEntry, v: ViewKey): boolean =>
    v.kind === "list"
      ? r.listId === v.id
      : v.kind === "focus" && r.focusIndex !== undefined;
  const lingerChain = createMemo(
    (): { ids: Set<string>; expiry: number } => {
      const v = view();
      if (v.kind !== "list" && v.kind !== "focus") {
        return { ids: new Set(), expiry: -Infinity };
      }
      const done = app
        .recentDone()
        .filter((r) => {
          if (!lingerMatches(r, v)) return false;
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
  // `state.listOpen[id]` array, so mutations in other lists (or in
  // Done/Bin) never invalidate it; item field edits track per-item
  // paths independently of the ordering. Done/Bin scan `itemsById`
  // lazily — the scan only runs while that view is active, and no
  // list-view mutation path pays for it.
  // Re-insert the linger group at the positions its rows vacated. Each
  // index was captured after earlier Done rows had already left the
  // projection, so replay the removals in reverse capture order to
  // reconstruct the original layout.
  const overlayLinger = (out: ItemView[], v: ViewKey): void => {
    lingerTick();
    const { ids: lingerIds, expiry } = lingerChain();
    if (Date.now() >= expiry) return;
    const captured: Array<{ index: number; value: ItemView }> = [];
    for (const r of app
      .recentDone()
      .filter((r) => lingerMatches(r, v) && lingerIds.has(r.id))) {
      const it = state.itemsById[r.id];
      if (!it || !isDone(it) || isBinned(it)) continue;
      captured.push({
        index: v.kind === "focus" ? (r.focusIndex ?? 0) : r.index,
        value: it,
      });
    }
    restoreCapturedPositions(out, captured);
  };
  const items = createMemo((): ItemView[] => {
    const v = view();
    if (v.kind === "list") {
      const out: ItemView[] = [];
      for (const id of state.listOpen[v.id] ?? []) {
        const it = state.itemsById[id];
        if (it) out.push(it);
      }
      overlayLinger(out, v);
      return out;
    }
    if (v.kind === "focus") {
      // The Focus lens: visible refs in curated order (spec/focus.md).
      // `focusOrder` is already Open-filtered + deduped by the engine; just
      // resolve each id to its item. Done auto-removes the ref, so the
      // linger overlay is the only thing keeping a just-completed row
      // visible for the strike-through beat.
      const out: ItemView[] = [];
      for (const id of state.focusOrder) {
        const it = state.itemsById[id];
        if (it) out.push(it);
      }
      overlayLinger(out, v);
      return out;
    }
    if (v.kind === "done") {
      // Done view excludes binned items: a done-then-binned item lives
      // in the Bin (see context menu — Bin owns the next transition).
      // Sorted by the workflow register's transition time desc.
      return Object.values(state.itemsById)
        .filter((it) => isDone(it) && !isBinned(it))
        .sort((a, b) => b.lifecycleAt - a.lifecycleAt);
    }
    return Object.values(state.itemsById)
      .filter(isBinned)
      .sort((a, b) => (b.binnedAt ?? 0) - (a.binnedAt ?? 0));
  });

  // Every user list in CRDT order — archived included. Use this for
  // name/title resolution, search provenance, and archived-list views;
  // the active/archived splits below feed the nav and destination
  // pickers (`spec/data-model.md` "Archived lists").
  const allLists = createMemo((): ListView[] =>
    state.listsOrder
      .map((id) => state.listsById[id])
      .filter((l): l is ListView => l !== undefined),
  );
  const activeLists = createMemo((): ListView[] =>
    allLists().filter((l) => l.archivedAt == null),
  );

  // Per-list open-item counts (Backlog + Live) for the nav badge, read
  // straight off the per-list projection arrays — no item scan. (The bin
  // badge reads the store's maintained `state.binCount` directly.) Home's
  // count always renders; non-Home lists are gated by the doc-level
  // `showListCounts` flag.
  const openCountsByList = createMemo((): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const [listId, ids] of Object.entries(state.listOpen)) {
      counts[listId] = ids.length;
    }
    return counts;
  });

  const dndRevision = createMemo(() => {
    const v = view();
    return `${v.kind}:${v.kind === "list" ? v.id : "-"}`;
  });

  // Id of the currently-viewed list iff it can be renamed. Only
  // user-created lists qualify: reserved `inbox` carries the localized
  // built-in label, and the done/bin cross-cutting views aren't lists.
  const editableListId = createMemo(() => {
    const v = view();
    return v.kind === "list" && v.id !== "inbox" ? v.id : null;
  });

  // The currently-viewed list's id iff that list is archived — drives
  // the header's Archived badge and flips the list menu's Archive /
  // Unarchive action.
  const archivedViewListId = createMemo((): string | null => {
    const v = view();
    if (v.kind !== "list") return null;
    return state.listsById[v.id]?.archivedAt != null ? v.id : null;
  });

  // Display label for any list id, matching the header/nav rules:
  // `inbox` is the localized built-in label, others use the stored name.
  // Used by Done-view rows to badge each item with its origin list.
  const listLabel = (listId: string): string =>
    listId === "inbox"
      ? m().nav.inbox
      : (state.listsById[listId]?.name ?? listId);

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
    if (v.kind === "focus") {
      // Drag-to-reorder within the Focus lens maps to `moveInFocus`, which
      // reorders the FocusRef in the curated (visible) order.
      const ids = items().map((it) => it.id);
      const moves = planReorderMoves(
        ids,
        op.keys.map(String),
        op.beforeKey === null ? null : String(op.beforeKey),
      );
      if (moves.length === 0) return;
      app.withActionBatch(() => {
        for (const move of moves) app.moveInFocus(move.id, move.index);
      });
      return;
    }
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

  // Capture new items straight into the Focus lens: each is created in the
  // inbox (Focus owns no items of its own — it's a lens) and pinned with a
  // FocusRef at a contiguous run starting at visible slot `atIndex`, all in
  // one undo step. Returns the new item ids.
  const captureToFocus = (texts: string[], atIndex: number): string[] =>
    app.withActionBatch(() => {
      // Append to the inbox (its open length is the append slot — a large
      // sentinel would overflow the wasm `usize`); the item's inbox position
      // is independent of its Focus position, fixed explicitly below.
      const inboxLen = app.state.listOpen["inbox"]?.length ?? 0;
      const ids = app.addItemsAt("inbox", texts, inboxLen);
      ids.forEach((id, i) => app.addToFocus(id, atIndex + i));
      return ids;
    });

  // Start a draft row: pseudo-item just below the topmost selected
  // item (or at the top if nothing is selected). Expanding it via the
  // controlled `expandedKey` flips the row into edit mode through the
  // same path used for existing rows. If a draft is already open, no-op
  // — the natural click-outside collapse on the existing draft will
  // settle it first.
  const startDraft = () => {
    const v = view();
    // Capture runs in list views and in the Focus lens; a Focus draft
    // creates its item in the inbox and pins it (see settleDraft).
    if (v.kind !== "list" && v.kind !== "focus") return;
    if (draft() !== null) return;
    const isFocus = v.kind === "focus";
    const listId = isFocus ? "inbox" : v.id;
    const ids = items().map((i) => i.id);
    const top = selection.getSelectionTop();
    let insertIndex = 0;
    if (top !== null) {
      const idx = ids.indexOf(String(top));
      if (idx >= 0) insertIndex = idx + 1;
    }
    const id = `${DRAFT_ID_PREFIX}${crypto.randomUUID()}`;
    const now = Date.now();
    const draftItem: ItemView = {
      id,
      listId,
      text: "",
      notes: "",
      state: "backlog",
      lifecycleAt: now,
      createdAt: now,
    };
    setDraft({ item: draftItem, insertIndex, listId, focus: isFocus });
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
    const newId = d.focus
      ? captureToFocus([text], d.insertIndex)[0]
      : app.addItemAt(d.listId, text, d.insertIndex);
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
    if (v.kind !== "list" && v.kind !== "focus") return;
    const target = e.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    const data = e.clipboardData?.getData("text") ?? "";
    const lines = data
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^-\s+(?:\[[^\]]*\]\s*)?/, ""))
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;
    e.preventDefault();

    // Board: land the block below the bottom-most selected card, in that
    // card's lane — same shape as duplicateBlock. Slots come straight from
    // the shared Open order (Backlog and Live are one array), so a Done-lane
    // or empty selection finds no slot and the block appends to Backlog.
    const boardId = boardListId();
    if (boardId !== null) {
      const linear = state.listOpen[boardId] ?? [];
      const selectedSlots = (actionSelection()?.getSelectedKeys() ?? [])
        .map((k) => linear.indexOf(String(k)))
        .filter((idx) => idx >= 0);
      const anchorIdx =
        selectedSlots.length === 0 ? -1 : Math.max(...selectedSlots);
      const anchor = anchorIdx >= 0 ? app.getItem(linear[anchorIdx]) : undefined;
      const boardIds = app.withActionBatch(() => {
        const created = app.addItemsAt(
          boardId,
          lines,
          anchorIdx >= 0 ? anchorIdx + 1 : linear.length,
        );
        // Created as Backlog; flip to the anchor's lane in the same undo
        // step, which keeps the just-assigned Open position (spec/board.md).
        if (anchor && anchor.state !== "backlog") {
          app.setLifecycleMany(created, anchor.state);
        }
        return created;
      });
      if (boardIds.length === 0) return;
      // Hand the block to the reveal path so it becomes the active lane
      // selection and scrolls into view.
      setBoardRevealIds(boardIds);
      return;
    }

    const visible = items().map((it) => it.id);
    const selectedHere = selection
      .getSelectedKeys()
      .map((k) => visible.indexOf(String(k)))
      .filter((idx) => idx >= 0);
    const insertAt =
      selectedHere.length === 0 ? visible.length : Math.max(...selectedHere) + 1;
    const ids =
      v.kind === "focus"
        ? captureToFocus(lines, insertAt)
        : app.addItemsAt(v.id, lines, insertAt);
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

  // Selection-scoped key actions (⌫, x, move) filter the selection down
  // to the ids that are actually on screen. On a board, the Done lane's
  // members come from a scan of `itemsById` (Board's `doneMembers`), not
  // the list's Open projection — so `items()` covers only the open lanes.
  // Add this board's done-but-not-binned items so a card selected in the
  // Done lane is actionable too.
  const withBoardDone = (visibleSet: Set<string>): Set<string> => {
    const boardId = boardListId();
    if (boardId !== null) {
      for (const it of Object.values(state.itemsById)) {
        if (it.listId === boardId && isDone(it) && !isBinned(it)) {
          visibleSet.add(it.id);
        }
      }
    }
    return visibleSet;
  };

  // Delete / Backspace on the active view: bin live or done items, hard-
  // delete binned ones. Skip when focus is inside an editable surface so
  // the AddForm, row edit, and list rename keep their native behaviour.
  const onDeleteKey = (e: KeyboardEvent) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const sel = actionSelection();
    if (!sel) return;
    const v = view();
    const visibleIds = items().map((it) => it.id);
    const visibleSet = withBoardDone(new Set(visibleIds));
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
    // Include the board's Done-lane cards so x on one un-does it (back to
    // Backlog — the core's undone rule, not the prior state).
    const visibleSet = withBoardDone(new Set(items().map((it) => it.id)));
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
    if (allDone && view().kind === "focus") app.undoneIntoFocus(ids);
    else app.setDoneMany(ids, !allDone);
  };
  onGlobalKey(onToggleDoneKey);

  // f: toggle Focus on the current selection. Mirrors the row context
  // menu's Add to focus / Remove from focus. Direction follows the group
  // like toggle-done: any not-focused → add all (the core skips ids that
  // are already focused or not Open), only remove when every selected item
  // is already in the Focus lens.
  const onToggleFocusKey = (e: KeyboardEvent) => {
    if (e.key !== "f" && e.key !== "F") return;
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
    const focusedSet = new Set(app.state.focusOrder);
    const allFocused = ids.every((id) => focusedSet.has(id));
    if (allFocused) app.removeFromFocusMany(ids);
    else app.addToFocusMany(ids);
  };
  onGlobalKey(onToggleFocusKey);

  // Open the move palette on `sourceIds`, kept in visible order so the
  // block lands in the target list in the user's visible sequence. Board
  // Done-lane cards aren't in `items()` (same situation as ⌫ above) —
  // they survive the visibility filter via the extended set and follow
  // the in-view rows.
  const openMovePalette = (sourceIds: readonly string[]) => {
    const visibleIds = items().map((it) => it.id);
    const visibleSet = withBoardDone(new Set(visibleIds));
    const sourceSet = new Set(sourceIds.map(String));
    const inView = visibleIds.filter((id) => sourceSet.has(id));
    const inViewSet = new Set(inView);
    const rest = [...sourceSet].filter(
      (id) => visibleSet.has(id) && !inViewSet.has(id),
    );
    const ids = [...inView, ...rest];
    if (ids.length > 0) setMoveIds(ids);
  };

  // The list the move palette annotates as "Current": only the list /
  // board views have one — in the cross-list views (Focus / Done / Bin)
  // the acted-on rows may come from anywhere.
  const moveCurrentId = () => {
    const v = view();
    return v.kind === "list" ? v.id : null;
  };

  // Move destinations: Inbox followed by every active user list —
  // archived lists are not offered, matching the task dialog's picker.
  const moveListOptions = createMemo<ListOption[]>(() => [
    { id: "inbox", name: m().nav.inbox },
    ...activeLists().map((l) => ({ id: l.id, name: l.name, icon: l.icon })),
  ]);

  // Commit a palette pick: mirrors the drag-into-nav drop above — un-done
  // and un-bin first, then land as the first items of the target list in
  // visible order, all one undo step. Picking the view's own list is a
  // no-op (not a reorder-to-top surprise), matching the task dialog's
  // picker.
  const moveBlockToList = (ids: readonly string[], targetListId: string) => {
    const v = view();
    if (v.kind === "list" && v.id === targetListId) return;
    const toUndone = ids.filter((id) => {
      const it = app.getItem(id);
      return it !== undefined && isDone(it);
    });
    const toUnbin = ids.filter((id) => {
      const it = app.getItem(id);
      return it !== undefined && isBinned(it);
    });
    app.withActionBatch(() => {
      if (toUndone.length > 0) app.setDoneMany(toUndone, false);
      if (toUnbin.length > 0) app.setBinnedMany(toUnbin, false);
      for (const [i, id] of ids.entries()) {
        app.moveItem(id, targetListId, i);
      }
    });
    // The moved rows have left this view, so a lingering selection would
    // be a phantom block anchor (see the drag-out handling below).
    actionSelection()?.clear();
  };

  // m: open the move palette on the current selection.
  const onMoveKey = (e: KeyboardEvent) => {
    if (e.key !== "m" && e.key !== "M") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const sel = actionSelection();
    if (!sel) return;
    const ids = sel.getSelectedKeys().map(String);
    if (ids.length === 0) return;
    e.preventDefault();
    openMovePalette(ids);
  };
  onGlobalKey(onMoveKey);

  // Duplicate live items as a contiguous block immediately after the
  // bottom-most source row — same shape as paste — rather than each
  // clone sitting under its own original. Shared by Cmd+D and the row
  // context menu's Duplicate action so both behave identically.
  // A clone is a full copy, not just the title: carry the notes and
  // deadline across. Both are no-ops when the source has neither, so the
  // batch stays a single undo step either way.
  const copyItemDetails = (
    id: string,
    src: { notes: string; deadline: string | undefined },
  ): void => {
    if (src.notes) app.editItemNotes(id, src.notes);
    if (src.deadline) app.setItemDeadline(id, src.deadline);
  };

  const duplicateBlock = (sourceIds: readonly string[]): void => {
    const v = view();
    if (v.kind === "focus") {
      // Focus owns no items — each clone is created in its source's own
      // list directly below its source (inheriting the source's lane),
      // falling back to the top of the inbox only if that list is gone,
      // then pinned as a contiguous block right after the bottom-most
      // source's Focus slot. One undo step.
      const visible = items().map((it) => it.id);
      const sourceSet = new Set(sourceIds);
      const sources: {
        id: string;
        idx: number;
        text: string;
        notes: string;
        deadline: string | undefined;
        state: WorkflowState;
        listId: string;
      }[] = [];
      visible.forEach((id, idx) => {
        if (!sourceSet.has(id)) return;
        const it = app.getItem(id);
        if (!it || !isOpen(it)) return;
        const listId = app.state.listsById[it.listId] ? it.listId : "inbox";
        sources.push({
          id,
          idx,
          text: it.text,
          notes: it.notes,
          deadline: it.deadline,
          state: it.state,
          listId,
        });
      });
      if (sources.length === 0) return;
      const insertAt = sources[sources.length - 1].idx + 1;
      // `state.listOpen` doesn't update until the batch flushes, so track
      // each touched list's Open order locally to keep the slots right when
      // several sources share a list.
      const openOrder: Record<string, string[]> = {};
      const newIds = app.withActionBatch(() => {
        const created: string[] = [];
        sources.forEach((s, i) => {
          const order = (openOrder[s.listId] ??= [
            ...(app.state.listOpen[s.listId] ?? []),
          ]);
          // Source missing from its own list's Open order (the inbox
          // fallback above, or a stale projection) — land the clone on top.
          const at = order.indexOf(s.id) + 1;
          const id = app.addItemAt(s.listId, s.text, at);
          order.splice(at, 0, id);
          copyItemDetails(id, s);
          if (s.state !== "backlog") app.setLifecycle(id, s.state);
          app.addToFocus(id, insertAt + i);
          created.push(id);
        });
        return created;
      });
      if (newIds.length === 0) return;
      queueMicrotask(() => {
        selection.selectOnly(newIds[0]);
        if (newIds.length > 1)
          selection.extendActive(newIds[newIds.length - 1]);
      });
      return;
    }
    if (v.kind !== "list") return;
    const visible = items().map((it) => it.id);
    const sourceSet = new Set(sourceIds);
    // Clones inherit the source's board lane: a dupe of an In Progress
    // card stays In Progress, a Backlog dupe stays Backlog.
    const sourcesInOrder: {
      idx: number;
      text: string;
      notes: string;
      deadline: string | undefined;
      state: WorkflowState;
    }[] = [];
    visible.forEach((id, idx) => {
      if (!sourceSet.has(id)) return;
      const it = app.getItem(id);
      if (!it || !isOpen(it)) return;
      sourcesInOrder.push({
        idx,
        text: it.text,
        notes: it.notes,
        deadline: it.deadline,
        state: it.state,
      });
    });
    if (sourcesInOrder.length === 0) return;
    const insertAt = sourcesInOrder[sourcesInOrder.length - 1].idx + 1;
    const texts = sourcesInOrder.map((s) => s.text);
    // Create the block (as Backlog), then flip each clone to its source's
    // lane in the same undo step. The state flip keeps the clone's
    // just-assigned Open position (spec/board.md).
    const newIds = app.withActionBatch(() => {
      const ids = app.addItemsAt(v.id, texts, insertAt);
      ids.forEach((id, i) => {
        const src = sourcesInOrder[i];
        if (!src) return;
        copyItemDetails(id, src);
        if (src.state !== "backlog") app.setLifecycle(id, src.state);
      });
      return ids;
    });
    if (newIds.length === 0) return;
    if (boardListId() !== null) {
      // On the board, hand the whole clone block to the reveal path so it
      // becomes the active lane selection and scrolls into view.
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
    if (view().kind !== "list" && view().kind !== "focus") return;

    // Focus is never a board, so boardId is null there and we fall through
    // to the inline-draft path below.
    const boardId = boardListId();
    if (boardId !== null) {
      e.preventDefault();
      const top = actionSelection()?.getSelectionTop() ?? null;
      const anchor = top !== null ? app.getItem(String(top)) : undefined;
      if (anchor && isOpen(anchor)) {
        // Below the selected card, in the selected card's lane.
        const linear = app.state.listOpen[boardId] ?? [];
        const at = linear.indexOf(anchor.id);
        setNewItemTarget({
          listId: boardId,
          state: anchor.state,
          index: at >= 0 ? at + 1 : 0,
        });
      } else {
        // Nothing selected: top of the first visible open lane.
        setNewItemTarget({
          listId: boardId,
          state: defaultCaptureLane(boardId),
          index: 0,
        });
      }
      return;
    }

    if (draft() !== null) return;
    e.preventDefault();
    startDraft();
  };
  onGlobalKey(onSpaceAdd);

  // [ / ]: cycle through the nav views in top-to-bottom order — Focus, Home,
  // Done, Bin, then the user lists (Bin only earns a slot while it holds
  // items, matching its nav visibility). Wraps at both ends. From a view that
  // isn't in the sequence (e.g. an emptied Bin), ] enters at the top and
  // [ at the bottom, so the bracket pair always re-enters the set.
  const viewKey = (v: ViewKey) => (v.kind === "list" ? `list:${v.id}` : v.kind);
  const onBracketNavigate = (e: KeyboardEvent) => {
    if (e.key !== "[" && e.key !== "]") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const seq: ViewKey[] = [
      { kind: "focus" },
      { kind: "list", id: "inbox" },
      { kind: "done" },
      ...(state.binCount > 0 ? [{ kind: "bin" } as ViewKey] : []),
      ...activeLists().map((l): ViewKey => ({ kind: "list", id: l.id })),
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

  // 1–4: jump straight to the fixed nav views (Focus / Inbox / Done / Bin).
  // Bin only counts while non-empty, matching its nav visibility. Mapping
  // and modifier guard live in digitNavTarget (pure, unit-tested);
  // onGlobalKey supplies the overlay / editable-surface guards.
  const onDigitNavigate = (e: KeyboardEvent) => {
    const target = digitNavTarget(e, state.binCount);
    if (!target) return;
    e.preventDefault();
    setView(target);
  };
  onGlobalKey(onDigitNavigate);

  // Drag items into a list nav button to move them to that list as the
  // first items, onto Bin to bin them, or onto Focus to pin them into the
  // Focus lens. Discriminate from the nav's own list-reorder drag by
  // checking detail.items[0] for an item-shaped record (`listId` is
  // present on ItemView, absent on ListView). Bubbling + composed means a
  // single document-level listener catches both Dnd instances.
  type DropTarget =
    | { kind: "list"; el: HTMLElement; listId: string }
    | { kind: "bin"; el: HTMLElement }
    | { kind: "focus"; el: HTMLElement };
  const findDropTarget = (x: number, y: number): DropTarget | null => {
    const el = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>(
        "[data-drop-list-id], [data-drop-bin], [data-drop-focus]",
      );
    if (!el) return null;
    if (el.dataset.dropListId !== undefined) {
      return { kind: "list", el, listId: el.dataset.dropListId };
    }
    if (el.dataset.dropFocus !== undefined) {
      return { kind: "focus", el };
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
    if (target.kind === "focus") {
      // Same behaviour as the row context menu's "Add to focus": the core
      // skips any id that is already focused or not Open, so a mixed drop
      // resolves cleanly. Items keep their list — nothing moves.
      app.addToFocusMany(idsInOrder);
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

  // Jump to `target` and re-anchor the dnd selection on `id`. The
  // selection + scroll bounce is deferred past the view-change effect
  // (which clears selection) and past the keyed Dnd remount, so the
  // new controller's source has the row's index when scrollToKey lands.
  const revealItem = (id: string, target: ViewKey): void => {
    setView(target);
    // If the destination list renders as a board, the list-view Dnd isn't
    // mounted — hand the id to the Board's reveal path (select + scroll in
    // the resolved column) instead of the list-view scroll below.
    if (target.kind === "list" && listView(target.id).board) {
      setBoardRevealIds([id]);
      return;
    }
    setTimeout(() => {
      selection.selectOnly(id);
      dndHandle?.scrollToKey(id);
    }, 0);
  };

  // Selecting a palette result: jump to the view that contains it. Built-in
  // views (Focus / Inbox / Done) and lists go straight to that view. Items
  // pick the view based on their lifecycle — binned items live in the Bin,
  // done-only items in Done, otherwise their list.
  const onFindSelect = (r: FindResult) => {
    if (r.kind === "view") {
      setView(r.id === "inbox" ? { kind: "list", id: "inbox" } : { kind: r.id });
      return;
    }
    if (r.kind === "list") {
      setView({ kind: "list", id: r.id });
      return;
    }
    revealItem(
      r.id,
      r.lifecycle === "binned"
        ? { kind: "bin" }
        : r.lifecycle === "done"
          ? { kind: "done" }
          : { kind: "list", id: r.listId || "inbox" },
    );
  };

  // Shared by both Find surfaces (desktop palette / mobile sheet).
  const onFindOpenChange = (open: boolean) => {
    setFindOpen(open);
    if (open) return;
    // Hand keyboard focus back to the items listbox on close (Escape
    // or a pick) — the palette stole it into its search input and
    // the view's shortcuts are keyed off the listbox having focus.
    // A pick may also switch views, so defer past the <Show keyed>
    // remount like the nav's onSelect does.
    requestAnimationFrame(() => restoreItemsFocus());
  };
  const onFindPick = (r: FindResult) => {
    // A pick navigates the workspace behind any open item's page
    // (mobile pills can open Find over it); close the item so the
    // result is actually visible.
    setOpenItemId(null);
    onFindSelect(r);
  };

  // Row context menu: hop an item between its home list and the Focus lens,
  // landing selected on the other side. "list" resolves the item's owning
  // list (falling back to the inbox if the id has gone stale); "focus" is
  // only offered for items that already carry a Focus ref, so the lens is
  // guaranteed to render it.
  const revealItemIn = (id: string, where: "list" | "focus"): void => {
    if (where === "focus") {
      revealItem(id, { kind: "focus" });
      return;
    }
    const listId = app.state.itemsById[id]?.listId;
    revealItem(id, {
      kind: "list",
      id: listId && app.state.listsById[listId] ? listId : "inbox",
    });
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

  // Mobile shell: at narrow viewports the sidebar (and its footer chrome)
  // is replaced by MobileBars (MobileShell.tsx), and the Find palette by FindSheet, a
  // tap-first list switcher over the same result set.
  const mobileMq = window.matchMedia("(max-width: 768px) and (pointer: coarse)");
  const [isMobile, setIsMobile] = createSignal(mobileMq.matches);
  const onMqChange = (e: MediaQueryListEvent) => {
    setIsMobile(e.matches);
  };
  mobileMq.addEventListener("change", onMqChange);
  onCleanup(() => mobileMq.removeEventListener("change", onMqChange));

  // Desktop sidebar collapse. Toggled from the app menu, which lives in
  // the sidebar's footer and floats bottom-left while the sidebar is hidden.
  const [navHidden, setNavHiddenSignal] = createSignal(loadNavHiddenPref());
  const setNavHidden = (hidden: boolean) => {
    setNavHiddenSignal(hidden);
    try {
      if (hidden) localStorage.setItem(NAV_HIDDEN_PREF_KEY, "1");
      else localStorage.removeItem(NAV_HIDDEN_PREF_KEY);
    } catch {
      // Quota/private-mode failures just lose the preference.
    }
  };

  // Desktop deadline rail (right-hand column). Toggled from the app menu;
  // persisted per browser like the nav.
  const [deadlinesOpen, setDeadlinesOpenSignal] = createSignal(
    loadDeadlinesOpenPref(),
  );
  const setDeadlinesOpen = (open: boolean) => {
    setDeadlinesOpenSignal(open);
    try {
      if (open) localStorage.setItem(DEADLINES_OPEN_PREF_KEY, "1");
      else localStorage.removeItem(DEADLINES_OPEN_PREF_KEY);
    } catch {
      // Quota/private-mode failures just lose the preference.
    }
  };

  const navigateTo = (v: ViewKey) => {
      setView(v);
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
  };

  return (
    <div
      class="app"
      classList={{
        "nav-hidden": navHidden(),
        "deadlines-open": !isMobile() && deadlinesOpen(),
      }}
    >
      <Show when={!isMobile()}>
      <Nav
        app={app}
        lists={activeLists()}
        binCount={state.binCount}
        focusCount={state.focusOrder.length}
        openCountsByList={openCountsByList()}
        showListCounts={state.settings.showListCounts}
        view={view()}
        setView={navigateTo}
        footer={
          <>
            <NavMenu
              app={app}
              session={session.session()}
              logout={session.logout}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenShortcuts={() => setShortcutsOpen(true)}
              onSession={session.swapSession}
              navHidden={navHidden()}
              onToggleNav={() => setNavHidden(!navHidden())}
              deadlinesOpen={deadlinesOpen()}
              onToggleDeadlines={() => setDeadlinesOpen(!deadlinesOpen())}
            />
            <StatusSlot
              app={app}
              online={session.online()}
              lastSyncAt={session.lastSyncAt()}
              session={session.session()}
              onSession={session.swapSession}
            />
          </>
        }
      />
      </Show>
      <Show
        when={isMobile()}
        fallback={
          <FindPalette
            app={app}
            open={findOpen()}
            onOpenChange={onFindOpenChange}
            onSelect={onFindPick}
          />
        }
      >
        <FindSheet
          app={app}
          open={findOpen()}
          view={view()}
          onOpenChange={onFindOpenChange}
          onSelect={onFindPick}
        />
      </Show>
      <MovePalette
        open={moveIds() !== null}
        onOpenChange={(open) => {
          if (open) return;
          setMoveIds(null);
          // Hand keyboard focus back to the items listbox — the palette
          // stole it into its filter input. Same restore the task dialog
          // does on close.
          restoreItemsFocus();
        }}
        options={moveListOptions}
        currentId={moveCurrentId}
        onPick={(listId) => {
          const ids = moveIds();
          if (ids) moveBlockToList(ids, listId);
        }}
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
        lists={activeLists}
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
      <DeadlineCalendarDialog
        open={() => deadlineTarget() !== null}
        setOpen={(o) => {
          if (!o) setDeadlineTarget(null);
        }}
        value={() => deadlineTarget()?.initial ?? null}
        onPick={(stamp) => {
          const t = deadlineTarget();
          if (t) for (const id of t.ids) app.setItemDeadline(id, stamp);
        }}
        onRemove={() => {
          const t = deadlineTarget();
          if (t) for (const id of t.ids) app.setItemDeadline(id, null);
        }}
      />
      <ShortcutsDialog
        open={shortcutsOpen()}
        onOpenChange={setShortcutsOpen}
      />
      <div class="content">
      <main class="main" tabIndex={-1}>
        <header class="main-header">
          {/* Title group at the left edge; .main-header's space-between
              keeps the action buttons on the right regardless of group
              width. */}
          <div class="main-header-title">
            {/* User-created lists carry a display icon (chosen emoji or
                the default glyph). Reserved `inbox` has no `ListMeta` row,
                so it can't store one — gated out. */}
            <Show when={editableListId() !== null}>
              <ListIconPicker
                icon={state.listsById[editableListId() ?? ""]?.icon}
                onPick={(icon) => app.setListIcon(editableListId() ?? "", icon)}
                onClear={() => app.setListIcon(editableListId() ?? "", "")}
              />
            </Show>
            {/* Reserved views (Focus, Home/Inbox, Done, Bin) can't store a
                custom icon, so mirror their fixed navbar glyph here as a
                static, non-interactive counterpart to the list icon. */}
            <Show when={viewIcon(view())} keyed>
              {(svg) => <span class="list-icon-static" innerHTML={svg} />}
            </Show>
            <h1>
            <Show
              keyed
              when={editableListId()}
              fallback={viewTitle(view(), allLists(), m())}
            >
              {(listId) => (
                <EditableNavLabel
                  class="editable-title"
                  name={allLists().find((l) => l.id === listId)?.name ?? listId}
                  onSave={(name) => app.renameList(listId, name)}
                />
              )}
            </Show>
          </h1>
            <Show when={archivedViewListId()}>
              <span class="badge">{m().nav.archived}</span>
            </Show>
          </div>
          <div class="main-header-actions">
            {/* Mobile: the sync indicator lives up here (there's no
                sidebar footer). Always mounted while mobile so its
                first-run auth prompt still fires on load, as on desktop. */}
            <Show when={isMobile()}>
              <StatusSlot
                class="glass"
                app={app}
                online={session.online()}
                lastSyncAt={session.lastSyncAt()}
                session={session.session()}
                onSession={session.swapSession}
              />
            </Show>
            {/* List actions menu: the same Archive / Unarchive the nav's
                context menu offers, kept here so restoring an archived
                list stays discoverable with the sidebar collapsed. Only
                user lists — `inbox` can't be archived. */}
            <Show when={editableListId()}>
              {(listId) => (
                <DropdownMenu>
                  <DropdownMenu.Trigger
                    class="nav-menu-trigger"
                    tabIndex={-1}
                    aria-label={m().common.menu}
                    innerHTML={dotsHorizontalSvg}
                  />
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class="dropdown-menu-content">
                      <DropdownMenu.Item
                        class="dropdown-menu-item"
                        onSelect={() =>
                          app.setListArchived(
                            listId(),
                            archivedViewListId() === null,
                          )
                        }
                      >
                        {archivedViewListId() !== null
                          ? m().nav.unarchiveList
                          : m().nav.archiveList}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              )}
            </Show>
            <Show
              when={
                view().kind === "bin" &&
                items().length > 0
              }
            >
              <button
                type="button"
                class="add-button"
                tabIndex={-1}
                onClick={() => setEmptyBinConfirmOpen(true)}
              >
                <span class="add-button-icon" innerHTML={trashSvg} />
                <span>{m().workspace.emptyBin}</span>
              </button>
            </Show>
            {/* Desktop: the view's icon buttons (display options, add)
                share one rounded glass group instead of per-button
                chrome. Hidden via CSS when the view contributes none. */}
            <div class="header-group">
            <Show when={view().kind === "list"}>
              <DisplayOptionsPopover>
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
                <Show when={boardListId()}>
                  {(listId) => (
                    <>
                      {/* Open-lane visibility (client-local, display-only —
                          spec/board.md "Lane visibility"). At least one
                          lane always stays on; the setters refuse the
                          hide that would blank the board. */}
                      <For each={OPEN_STATES}>
                        {(lane) => (
                          <LaneRow
                            name={laneLabel(m(), lane)}
                            count={boardLaneCounts()[lane]}
                            visible={visibleOpenLanes(listId()).includes(lane)}
                            onToggle={(show) => setLaneVisible(listId(), lane, show)}
                          />
                        )}
                      </For>
                      <LaneRow
                        name={m().board.showDoneColumn}
                        count={boardLaneCounts().done}
                        visible={showDoneColumn(listId())}
                        onToggle={(show) => setShowDoneColumn(listId(), show)}
                      />
                    </>
                  )}
                </Show>
                {/* Publish this view as the list's default for every
                    device. Disabled once it already is the default —
                    the label then reads as a state, not an action. */}
                <Show when={currentListId()}>
                  {(listId) => (
                    <button
                      type="button"
                      class="view-default-button"
                      disabled={isSavedDefault(listId())}
                      onClick={() => saveViewAsDefault(listId())}
                    >
                      {isSavedDefault(listId())
                        ? m().board.savedAsDefault
                        : m().board.saveAsDefault}
                    </button>
                  )}
                </Show>
              </DisplayOptionsPopover>
            </Show>
            <Show when={view().kind === "done"}>
              <DisplayOptionsPopover>
                <Switch
                  class="done-switch"
                  checked={doneShowList()}
                  onChange={(checked) => setDoneShowList(checked)}
                >
                  <Switch.Label class="done-switch-label">
                    {m().workspace.showOriginList}
                  </Switch.Label>
                  <Switch.Input class="done-switch-input" />
                  <Switch.Control class="done-switch-control">
                    <Switch.Thumb class="done-switch-thumb" />
                  </Switch.Control>
                </Switch>
              </DisplayOptionsPopover>
              <Tooltip openDelay={200} closeDelay={0} placement="bottom">
                <Tooltip.Trigger
                  as="button"
                  type="button"
                  class="add-button"
                  tabIndex={-1}
                  aria-label={m().workspace.log}
                  onClick={() =>
                    setNewItemTarget({
                      listId: "inbox",
                      state: "backlog",
                      done: true,
                    })
                  }
                >
                  <span class="add-button-icon" innerHTML={plusSvg} />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content class="tooltip-content">
                    {m().workspace.log}
                    <Tooltip.Arrow />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip>
            </Show>
            <Show when={view().kind === "focus"}>
              <DisplayOptionsPopover>
                <Switch
                  class="done-switch"
                  checked={focusShowList()}
                  onChange={(checked) => setFocusShowList(checked)}
                >
                  <Switch.Label class="done-switch-label">
                    {m().workspace.showOriginList}
                  </Switch.Label>
                  <Switch.Input class="done-switch-input" />
                  <Switch.Control class="done-switch-control">
                    <Switch.Thumb class="done-switch-thumb" />
                  </Switch.Control>
                </Switch>
              </DisplayOptionsPopover>
            </Show>
            <Show when={view().kind === "list" || view().kind === "focus"}>
              <Tooltip openDelay={200} closeDelay={0} placement="bottom">
              <Tooltip.Trigger
                as="button"
                type="button"
                class="add-button"
                tabIndex={-1}
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
                    // into the first visible open lane, mirroring that
                    // lane's own "+".
                    setNewItemTarget({
                      listId: boardId,
                      state: defaultCaptureLane(boardId),
                    });
                  } else {
                    startDraft();
                  }
                }}
                disabled={boardListId() === null && draft() !== null}
                aria-label={m().common.add}
              >
                <span class="add-button-icon" innerHTML={plusSvg} />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content class="tooltip-content">
                  {m().common.add}
                  <Tooltip.Arrow />
                </Tooltip.Content>
              </Tooltip.Portal>
              </Tooltip>
            </Show>
            </div>
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
                  {view().kind === "focus"
                    ? m().focus.empty
                    : view().kind === "list" && matchesKbDevice()
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
                  itemHeight={rowHeight(itemsIsMobile())}
                  expandable
                  clearOnClickOutside
                  fillHeight
                  autofocus
                  reorder={view().kind === "list" || view().kind === "focus"}
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
                        showList={() =>
                          view().kind === "focus"
                            ? focusShowList()
                            : doneShowList()
                        }
                        listLabel={listLabel}
                        duplicateBlock={duplicateBlock}
                        copyBlock={copyBlock}
                        onDraftSettle={settleDraft}
                        onOpen={(id, focus, caret) => {
                          if (focus) setOpenFocus(focus);
                          if (caret != null) setOpenCaret(caret);
                          setOpenItemId(id);
                        }}
                        onSetDeadline={openDeadlineCalendar}
                        onReveal={revealItemIn}
                        onMoveToList={openMovePalette}
                        openOnTap={itemsIsMobile}
                        scrollToKey={(k) => dndHandle?.scrollToKey(k)}
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
              onSetDeadline={openDeadlineCalendar}
              onReveal={revealItemIn}
              onMoveToList={openMovePalette}
              openOnTap={itemsIsMobile}
              duplicateBlock={duplicateBlock}
              copyBlock={copyBlock}
              onAddItem={(listId, state, done) =>
                setNewItemTarget({ listId, state, done })
              }
              revealIds={boardRevealIds}
              clearReveal={() => setBoardRevealIds(null)}
              onActiveSelectionChange={setBoardSelection}
              showDoneColumn={() => showDoneColumn(listId)}
              visibleOpenLanes={() => visibleOpenLanes(listId)}
              ref={(h) => (boardHandle = h)}
            />
          )}
        </Show>
      </main>
      </div>
      <Show when={!isMobile() && deadlinesOpen()}>
        <Deadlines
          app={app}
          onReveal={(id) => {
            setOpenItemId(null);
            revealItemIn(id, "list");
          }}
        />
      </Show>
      <Show when={isMobile()}>
        <MobileBars
          onFind={() => setFindOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onAdd={
            (view().kind === "list" || view().kind === "focus") &&
            boardListId() === null
              ? () => {
                  // The pills stay live over an open item's page; Add
                  // captures into the list behind it, so close it first.
                  setOpenItemId(null);
                  startDraft();
                }
              : null
          }
          addDisabled={draft() !== null}
        />
      </Show>
    </div>
  );
}

function viewTitle(
  v: ViewKey,
  lists: { id: string; name: string }[],
  m: ReturnType<typeof useAppI18n>["m"] extends () => infer T ? T : never,
): string {
  if (v.kind === "list") {
    // Reserved `inbox` has no `ListMeta` row — it always renders the
    // localized built-in label.
    if (v.id === "inbox") return m.nav.inbox;
    return lists.find((l) => l.id === v.id)?.name ?? v.id;
  }
  if (v.kind === "focus") return m.nav.focus;
  if (v.kind === "done") return m.nav.done;
  return m.nav.bin;
}

/** Fixed navbar glyph for a reserved view (Focus, Home/Inbox, Done, Bin),
 *  or `null` for user lists (which carry their own `ListIconPicker`). Keep
 *  these in sync with the icons used in `nav.tsx`. */
function viewIcon(v: ViewKey): string | null {
  if (v.kind === "focus") return drawingPinSvg;
  if (v.kind === "done") return checkSvg;
  if (v.kind === "bin") return crumpledPaperSvg;
  if (v.kind === "list" && v.id === "inbox") return archiveSvg;
  return null;
}
