// Kanban board view of one list (spec/kanban.md). A second lens over
// the same live projection the list view renders: grouping is each
// item's column register resolved valid-or-default, ordering within a
// column is the list's single linear order filtered to that column.
//
// Every column hosts its own Dnd instance, so within-column reorders
// use the standard placeholder/nudge machinery. Cross-column drops ride
// the dnd's foreign-drop-zone contract: each column carries a
// `data-drop-column-id`, a document-level `primavera-dnd-dragend`
// listener hit-tests the pointer and consumes the drag (preventDefault
// suppresses the source column's snap-back reorder), and the move maps
// to one `setItemColumn` per dragged row — register write + linear
// reorder in one commit each.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Dnd, DndSelection, type DndImperative, type DndOp } from "./dnd/solid";
import type { DndDragEventDetail } from "./dnd";
import dotsVerticalSvg from "./icons/dots-vertical.svg?raw";
import plusSvg from "./icons/plus.svg?raw";
import { useAppI18n } from "./i18n.tsx";
import { EditableNavLabel } from "./nav.tsx";
import { Row } from "./Row.tsx";
import { planReorderMoves } from "./reorder.ts";
import type { ColumnView, DocApp, ItemView } from "./sync/store.ts";

/** Sentinel key for the implicit default column in DOM attributes and
 *  group maps — a column id can never be the empty string. */
const DEFAULT_COL = "";

/** Fixed card height — the `itemHeight` passed to each column's Dnd. The
 *  foreign-drag preview (placeholder/nudge) and its insertion-slot math
 *  live in the Dnd controller now; the board only needs this to size the
 *  cards uniformly. Board cards are taller than list rows so the title can
 *  wrap to two lines (see `.board-col-dnd .row-text` in styles.css). */
const CARD_HEIGHT = 84;

/** Px gutter below each card within its fixed slot — mirrors the card's
 *  `height: calc(100% - 0.25em)` (0.25em = 4px at the 16px root) so the drop
 *  placeholder lines up with the cards. Passed to each column's Dnd. */
const CARD_GAP = 4;

/** Pointer-driven horizontal autoscroll for the board strip. */
const H_SCROLL_EDGE = 48;
const H_SCROLL_STEP = 14;

export function Board(props: {
  app: DocApp;
  listId: string;
  onOpen: (id: string, focus?: "notes") => void;
  openOnTap: () => boolean;
  duplicateBlock: (sourceIds: readonly string[]) => void;
  copyBlock: (sourceIds: readonly string[]) => void;
  /** Open the new-item dialog targeting a column (`null` = default). */
  onAddItem: (listId: string, columnId: string | null) => void;
  /** Id of a just-created item to select and scroll into view once it
   *  lands in its resolved column; `null` when nothing pending. */
  revealId?: () => string | null;
  /** Called by the board once it has revealed `revealId`. */
  clearReveal?: () => void;
  /** Publishes the board's active (most recently populated) column
   *  selection, or `null` when nothing is selected, so the workspace's
   *  global item shortcuts can act on it. */
  onActiveSelectionChange?: (sel: DndSelection | null) => void;
}) {
  const { m } = useAppI18n();
  const app = props.app;
  const state = app.state;

  const columns = createMemo(
    (): ColumnView[] => state.columnsByList[props.listId] ?? [],
  );
  const defaultName = createMemo(
    (): string =>
      state.defaultColumnNames[props.listId] ?? m().board.defaultColumn,
  );

  // Live projection partitioned by resolved column. One walk of the
  // list's live array; a register naming no current column resolves to
  // the default group, so deleted columns' members fall through here
  // with zero item writes (spec/kanban.md).
  const membersByColumn = createMemo((): Map<string, ItemView[]> => {
    const valid = new Set(columns().map((c) => c.id));
    const groups = new Map<string, ItemView[]>();
    groups.set(DEFAULT_COL, []);
    for (const c of columns()) groups.set(c.id, []);
    for (const id of state.listLive[props.listId] ?? []) {
      const it = state.itemsById[id];
      if (!it) continue;
      const key = it.column && valid.has(it.column) ? it.column : DEFAULT_COL;
      groups.get(key)!.push(it);
    }
    return groups;
  });

  const resolvedColumnOf = (id: string): string => {
    const it = state.itemsById[id];
    if (!it?.column) return DEFAULT_COL;
    return columns().some((c) => c.id === it.column) ? it.column : DEFAULT_COL;
  };

  // End-of-column drops have no `beforeKey`; anchor on the first live
  // item after the column's last surviving member so the block lands at
  // the column's tail without disturbing other columns' interleaving.
  // `null` = append to the list end; `undefined` = the column has no
  // surviving members, so linear position is irrelevant (register-only).
  const planAnchor = (
    memberIds: readonly string[],
    moved: ReadonlySet<string>,
    beforeKey: string | null,
  ): string | null | undefined => {
    if (beforeKey !== null) return beforeKey;
    const live = state.listLive[props.listId] ?? [];
    const remaining = memberIds.filter((id) => !moved.has(id));
    if (remaining.length === 0) return undefined;
    const last = remaining[remaining.length - 1];
    for (let i = live.indexOf(last) + 1; i < live.length; i++) {
      if (!moved.has(live[i])) return live[i];
    }
    return null;
  };

  // Within-column reorder: map the column-local drop to global linear
  // moves. Registers are untouched — same column, same membership.
  const reorderWithin = (colKey: string, op: DndOp<ItemView>): void => {
    if (op.type !== "move") return;
    const moved = op.keys.map(String);
    const memberIds = (membersByColumn().get(colKey) ?? []).map((it) => it.id);
    const anchor = planAnchor(
      memberIds,
      new Set(moved),
      op.beforeKey === null ? null : String(op.beforeKey),
    );
    if (anchor === undefined) return;
    const live = state.listLive[props.listId] ?? [];
    const moves = planReorderMoves(live, moved, anchor);
    if (moves.length === 0) return;
    app.withActionBatch(() => {
      for (const move of moves) app.moveItem(move.id, props.listId, move.index);
    });
  };

  // Cross-column drop: register write + linear placement before
  // `anchor`, one commit per row (`setItemColumn`). `anchor: null`
  // appends to the list end; `undefined` means the target column has
  // no surviving members, so linear position is irrelevant.
  const dropIntoColumn = (
    colKey: string,
    movedInOrder: string[],
    anchor: string | null | undefined,
  ): void => {
    const targetCol = colKey === DEFAULT_COL ? null : colKey;
    const live = state.listLive[props.listId] ?? [];
    const planned =
      anchor === undefined ? [] : planReorderMoves(live, movedInOrder, anchor);
    const plannedIds = new Set(planned.map((p) => p.id));
    app.withActionBatch(() => {
      for (const p of planned) app.setItemColumn(p.id, targetCol, p.index);
      for (const id of movedInOrder) {
        if (!plannedIds.has(id)) app.setItemColumn(id, targetCol);
      }
    });
  };

  // Live Dnd handles per column (keyed by colKey), registered by each
  // BoardColumn on mount. The cross-column drag listener drives the
  // hovered foreign column's placeholder/nudge/autoscroll preview through
  // these and reads back the previewed insertion slot at drop time — so
  // the drop lands exactly where the preview showed. This is the shared
  // "DragContext": the board is the context coordinating its columns.
  const columnHandles = new Map<string, DndImperative>();
  const registerHandle = (colKey: string, handle: DndImperative | null) => {
    if (handle) columnHandles.set(colKey, handle);
    else columnHandles.delete(colKey);
  };
  const clearAllForeignHover = () => {
    for (const h of columnHandles.values()) h.clearForeignHover();
  };

  // One selection model per column, owned by the board (keyed by the
  // stable colKey) so a column remount doesn't drop its selection and so
  // the cross-column drop below can make the moved rows the target
  // column's new selection. Cross-column multi-select still isn't
  // supported — each column's Dnd owns its own order.
  //
  // The board also tracks which column's selection is "active" (the most
  // recently populated one) and publishes it upward, so the workspace's
  // global item shortcuts (Enter/open, x/done, ⌫/bin, ⌘C, ⌘D) act on the
  // board selection just as they do on the list view's single selection.
  const columnSelections = new Map<string, DndSelection>();
  const [activeSelection, setActiveSelection] =
    createSignal<DndSelection | null>(null);
  const selectionFor = (colKey: string): DndSelection => {
    let s = columnSelections.get(colKey);
    if (!s) {
      const sel = new DndSelection();
      sel.onChange(() => {
        if (sel.hasSelection()) {
          // Selecting in one column is board-wide single selection: drop any
          // stale highlight in the other columns and become the active one.
          for (const other of columnSelections.values()) {
            if (other !== sel && other.hasSelection()) other.clear();
          }
          setActiveSelection(sel);
        } else if (activeSelection() === sel) {
          setActiveSelection(null);
        }
      });
      columnSelections.set(colKey, sel);
      s = sel;
    }
    return s;
  };
  createEffect(() => props.onActiveSelectionChange?.(activeSelection()));
  onCleanup(() => props.onActiveSelectionChange?.(null));

  // After a cross-column drop, make the dropped rows the target column's
  // selection. The mutation is applied synchronously but the moved rows
  // only appear in the target's member list once the reactive graph
  // settles, so we stage the request and apply it when the rows have
  // actually landed (their order is then known, so the block ranges are
  // correct regardless of effect timing).
  const [pendingSelect, setPendingSelect] = createSignal<{
    colKey: string;
    ids: string[];
  } | null>(null);
  createEffect(() => {
    const p = pendingSelect();
    if (!p) return;
    const members = membersByColumn().get(p.colKey);
    if (!members) return;
    const memberIds = members.map((it) => it.id);
    const present = new Set(memberIds);
    if (!p.ids.every((id) => present.has(id))) return;
    const sel = columnSelections.get(p.colKey);
    if (sel) {
      sel.updateOrder(memberIds);
      sel.setSelectedKeys(p.ids);
      const handle = columnHandles.get(p.colKey);
      handle?.focus();
      // Scroll the (last) selected card into view — after a board "+"
      // capture the new card may be below the fold in a tall column.
      if (p.ids.length > 0) handle?.scrollToKey(p.ids[p.ids.length - 1]);
    }
    setPendingSelect(null);
  });

  // Reveal a just-created item (board "+" capture): once it lands in its
  // resolved column, stage it as that column's selection — the effect
  // above then selects, focuses, and scrolls it into view. Waits for the
  // reactive graph to settle (the item may not be projected yet).
  createEffect(() => {
    const id = props.revealId?.() ?? null;
    if (!id) return;
    if (!state.itemsById[id]) return;
    const colKey = resolvedColumnOf(id);
    const members = membersByColumn().get(colKey);
    if (!members?.some((it) => it.id === id)) return;
    setPendingSelect({ colKey, ids: [id] });
    props.clearReveal?.();
  });

  // Foreign-drop wiring (see dnd/spec.md "Foreign drop zones"). The
  // workspace's own nav/bin drop listener coexists: hit-tests are
  // disjoint, and this one only consumes drops landing on a *different*
  // column — same-column drops fall through to the source Dnd's
  // internal reorder.
  const findColumnAt = (x: number, y: number): HTMLElement | null =>
    document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-drop-column-id]") ?? null;
  const isItemDrag = (detail: DndDragEventDetail): boolean => {
    const first = detail.firstItem;
    return typeof first === "object" && first !== null && "listId" in first;
  };
  const clearColumnHighlight = () => {
    document
      .querySelectorAll<HTMLElement>(".board-col[data-drop-active]")
      .forEach((el) => delete el.dataset.dropActive);
  };
  const onDragMove = (e: Event) => {
    const ce = e as CustomEvent<DndDragEventDetail>;
    if (!isItemDrag(ce.detail)) return;
    // Horizontal autoscroll of the board strip near its edges —
    // pointer-move-driven, which is enough at card-drag speeds.
    if (boardRef) {
      const rect = boardRef.getBoundingClientRect();
      if (ce.detail.y >= rect.top && ce.detail.y <= rect.bottom) {
        if (ce.detail.x < rect.left + H_SCROLL_EDGE) {
          boardRef.scrollLeft -= H_SCROLL_STEP;
        } else if (ce.detail.x > rect.right - H_SCROLL_EDGE) {
          boardRef.scrollLeft += H_SCROLL_STEP;
        }
      }
    }
    clearColumnHighlight();
    const el = findColumnAt(ce.detail.x, ce.detail.y);
    const keys = ce.detail.keys.map(String);
    // The hovered column is a *foreign* drop target only when it's a
    // different column from where the dragged rows currently live.
    const targetCol =
      el &&
      !keys.every(
        (k) => resolvedColumnOf(k) === (el.dataset.dropColumnId ?? DEFAULT_COL),
      )
        ? (el.dataset.dropColumnId ?? DEFAULT_COL)
        : null;
    // Preview the drop in the hovered foreign column; clear every other
    // column (including the source, whose own controller suppresses its
    // placeholder/nudge once the pointer leaves its bounds).
    for (const [colKey, handle] of columnHandles) {
      if (colKey === targetCol) handle.setForeignHover(ce.detail.x, ce.detail.y);
      else handle.clearForeignHover();
    }
    if (targetCol !== null && el) el.dataset.dropActive = "";
  };
  const onDragEnd = (e: Event) => {
    const ce = e as CustomEvent<DndDragEventDetail>;
    clearColumnHighlight();
    if (!isItemDrag(ce.detail)) {
      clearAllForeignHover();
      return;
    }
    const el = findColumnAt(ce.detail.x, ce.detail.y);
    const colKey = el ? (el.dataset.dropColumnId ?? DEFAULT_COL) : null;
    const keys = ce.detail.keys.map(String);
    // Same-column (or off-board) drop → the source column's internal
    // reorder owns it; nothing to consume here.
    if (colKey === null || keys.every((k) => resolvedColumnOf(k) === colKey)) {
      clearAllForeignHover();
      return;
    }
    ce.preventDefault();
    // The target column's preview computed the exact insertion slot — read
    // it back so the drop lands where the placeholder was. `foreignIdx` is
    // a slot in that column's member order (0..count); >= count (or null,
    // if the pointer never registered a hover) means tail append.
    const foreignIdx = columnHandles.get(colKey)?.getForeignHoverIndex() ?? null;
    clearAllForeignHover();
    // Preserve the source column's visible order for multi-row drops.
    const live = state.listLive[props.listId] ?? [];
    const keySet = new Set(keys);
    const inOrder = live.filter((id) => keySet.has(id));
    if (inOrder.length === 0) return;
    const memberIds = (membersByColumn().get(colKey) ?? []).map((it) => it.id);
    const remaining = memberIds.filter((id) => !keySet.has(id));
    const anchor =
      foreignIdx !== null && foreignIdx < remaining.length
        ? remaining[foreignIdx]
        : planAnchor(memberIds, keySet, null);
    // The dragged rows all share one source column (cross-column
    // multi-select isn't supported); clear its now-stale selection, then
    // stage the moved rows to become the target column's selection.
    const sourceCols = new Set(keys.map((k) => resolvedColumnOf(k)));
    dropIntoColumn(colKey, inOrder, anchor);
    for (const c of sourceCols) columnSelections.get(c)?.clear();
    setPendingSelect({ colKey, ids: inOrder });
  };
  document.addEventListener("primavera-dnd-dragmove", onDragMove);
  document.addEventListener("primavera-dnd-dragend", onDragEnd);
  onCleanup(() => {
    document.removeEventListener("primavera-dnd-dragmove", onDragMove);
    document.removeEventListener("primavera-dnd-dragend", onDragEnd);
  });

  let boardRef: HTMLDivElement | undefined;

  // Add-column affordance: a ghost column that flips into an input.
  const [addingColumn, setAddingColumn] = createSignal(false);
  let addColumnInput: HTMLInputElement | undefined;
  createEffect(() => {
    if (addingColumn()) queueMicrotask(() => addColumnInput?.focus());
  });
  const commitNewColumn = () => {
    const name = addColumnInput?.value.trim() ?? "";
    setAddingColumn(false);
    if (name.length === 0) return;
    app.addColumn(props.listId, name);
  };

  return (
    <div class="board" role="group" ref={boardRef}>
      <BoardColumn
        app={app}
        listId={props.listId}
        colKey={DEFAULT_COL}
        name={defaultName()}
        selection={selectionFor(DEFAULT_COL)}
        members={() => membersByColumn().get(DEFAULT_COL) ?? []}
        onRename={(name) => app.setDefaultColumnName(props.listId, name)}
        onReorder={(op) => reorderWithin(DEFAULT_COL, op)}
        onAddItem={() => props.onAddItem(props.listId, null)}
        registerHandle={registerHandle}
        onOpen={props.onOpen}
        openOnTap={props.openOnTap}
        duplicateBlock={props.duplicateBlock}
        copyBlock={props.copyBlock}
      />
      <For each={columns()}>
        {(col, i) => (
          <BoardColumn
            app={app}
            listId={props.listId}
            colKey={col.id}
            name={col.name}
            selection={selectionFor(col.id)}
            members={() => membersByColumn().get(col.id) ?? []}
            onRename={(name) => {
              if (name.length > 0) app.renameColumn(props.listId, col.id, name);
            }}
            onReorder={(op) => reorderWithin(col.id, op)}
            onAddItem={() => props.onAddItem(props.listId, col.id)}
            registerHandle={registerHandle}
            onOpen={props.onOpen}
            openOnTap={props.openOnTap}
            duplicateBlock={props.duplicateBlock}
            copyBlock={props.copyBlock}
            menu={{
              moveLeft:
                i() > 0
                  ? () => app.moveColumn(props.listId, col.id, i() - 1)
                  : undefined,
              moveRight:
                i() < columns().length - 1
                  ? () => app.moveColumn(props.listId, col.id, i() + 1)
                  : undefined,
              // Members fall to the default column visually; registers
              // stay put so undo restores the grouping (spec/kanban.md).
              delete: () => app.deleteColumn(props.listId, col.id),
            }}
          />
        )}
      </For>
      <div class="board-add-col">
        <Show
          when={addingColumn()}
          fallback={
            <button
              type="button"
              class="board-add-col-button"
              onClick={() => setAddingColumn(true)}
            >
              <span class="add-button-icon" innerHTML={plusSvg} />
              <span>{m().board.addColumn}</span>
            </button>
          }
        >
          <input
            ref={addColumnInput}
            class="board-add-col-input"
            placeholder={m().board.columnNamePlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitNewColumn();
              if (e.key === "Escape") setAddingColumn(false);
            }}
            onBlur={commitNewColumn}
          />
        </Show>
      </div>
    </div>
  );
}

function BoardColumn(props: {
  app: DocApp;
  listId: string;
  /** Column id, or `DEFAULT_COL` for the implicit default column. */
  colKey: string;
  name: string;
  /** Selection model for this column, owned by the board. */
  selection: DndSelection;
  members: () => ItemView[];
  onRename: (name: string) => void;
  onReorder: (op: DndOp<ItemView>) => void;
  /** Open the new-item dialog targeting this column. */
  onAddItem: () => void;
  onOpen: (id: string, focus?: "notes") => void;
  openOnTap: () => boolean;
  duplicateBlock: (sourceIds: readonly string[]) => void;
  copyBlock: (sourceIds: readonly string[]) => void;
  /** Publish this column's Dnd handle to the board so the cross-column
   *  drag listener can drive its foreign-drop preview. */
  registerHandle: (colKey: string, handle: DndImperative | null) => void;
  /** User columns only — the default column can't move or be deleted. */
  menu?: {
    moveLeft?: () => void;
    moveRight?: () => void;
    delete: () => void;
  };
}) {
  const { m } = useAppI18n();
  const app = props.app;
  // Selection is owned by the board (per column) — see Board.selectionFor.
  const selection = props.selection;
  const [dndItems, setDndItems] = createSignal<ItemView[]>([]);
  createEffect(() => setDndItems(props.members()));
  onCleanup(() => props.registerHandle(props.colKey, null));
  let startRename: (() => void) | undefined;

  return (
    <section class="board-col" data-drop-column-id={props.colKey}>
      <header class="board-col-header">
        <EditableNavLabel
          class="board-col-name"
          name={props.name}
          onSave={props.onRename}
          registerStart={(fn) => (startRename = fn)}
        />
        <span class="board-col-count">{props.members().length}</span>
        <button
          type="button"
          class="board-col-add-btn"
          aria-label={m().board.addItem}
          onClick={() => props.onAddItem()}
          innerHTML={plusSvg}
        />
        <DropdownMenu>
          <DropdownMenu.Trigger
            class="board-col-menu-trigger"
            aria-label={m().common.menu}
            innerHTML={dotsVerticalSvg}
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="dropdown-menu-content">
              <DropdownMenu.Item
                class="dropdown-menu-item"
                onSelect={() => {
                  // Defer past the menu close + focus restore so the
                  // contenteditable keeps the focus it grabs.
                  requestAnimationFrame(() => startRename?.());
                }}
              >
                {m().board.renameColumn}
              </DropdownMenu.Item>
              <Show when={props.menu}>
                {(menu) => (
                  <>
                    <Show when={menu().moveLeft}>
                      <DropdownMenu.Item
                        class="dropdown-menu-item"
                        onSelect={() => menu().moveLeft!()}
                      >
                        {m().board.moveLeft}
                      </DropdownMenu.Item>
                    </Show>
                    <Show when={menu().moveRight}>
                      <DropdownMenu.Item
                        class="dropdown-menu-item"
                        onSelect={() => menu().moveRight!()}
                      >
                        {m().board.moveRight}
                      </DropdownMenu.Item>
                    </Show>
                    <DropdownMenu.Separator class="dropdown-menu-separator" />
                    <DropdownMenu.Item
                      class="dropdown-menu-item"
                      onSelect={() => menu().delete()}
                    >
                      {m().board.deleteColumn}
                    </DropdownMenu.Item>
                  </>
                )}
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </header>
      <div class="board-col-body">
        <Dnd
          class="board-col-dnd"
          ref={(h) => props.registerHandle(props.colKey, h)}
          items={dndItems()}
          setItems={setDndItems}
          getKey={(it) => it.id}
          selection={selection}
          itemHeight={CARD_HEIGHT}
          placeholderGap={CARD_GAP}
          fillHeight
          reorder
          onReorder={props.onReorder}
        >
          {(item, expanded) => (
            <Row
              item={item}
              expanded={expanded}
              app={app}
              selection={selection}
              viewKind="list"
              duplicateBlock={props.duplicateBlock}
              copyBlock={props.copyBlock}
              onOpen={props.onOpen}
              openOnTap={props.openOnTap}
              showCreated
            />
          )}
        </Dnd>
      </div>
    </section>
  );
}
