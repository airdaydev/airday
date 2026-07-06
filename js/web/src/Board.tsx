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
import { Dnd, DndSelection, type DndOp } from "./dnd/solid";
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

/** Fixed card height — must match the `itemHeight` passed to each
 *  column's Dnd; cross-column drops divide by it to derive the
 *  insertion index from the pointer's y. */
const CARD_HEIGHT = 28;

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
    if (!el) return;
    const colKey = el.dataset.dropColumnId ?? DEFAULT_COL;
    const keys = ce.detail.keys.map(String);
    if (keys.every((k) => resolvedColumnOf(k) === colKey)) return;
    el.dataset.dropActive = "";
  };
  const onDragEnd = (e: Event) => {
    const ce = e as CustomEvent<DndDragEventDetail>;
    clearColumnHighlight();
    if (!isItemDrag(ce.detail)) return;
    const el = findColumnAt(ce.detail.x, ce.detail.y);
    if (!el) return;
    const colKey = el.dataset.dropColumnId ?? DEFAULT_COL;
    const keys = ce.detail.keys.map(String);
    // Same-column drop → the source column's internal reorder owns it.
    if (keys.every((k) => resolvedColumnOf(k) === colKey)) return;
    ce.preventDefault();
    // Preserve the source column's visible order for multi-row drops.
    const live = state.listLive[props.listId] ?? [];
    const keySet = new Set(keys);
    const inOrder = live.filter((id) => keySet.has(id));
    if (inOrder.length === 0) return;
    // Positional drop: the pointer's y inside the target column's
    // scroll container picks the in-column insertion slot; below the
    // last card (or with no survivors) it's a tail append. No
    // placeholder preview yet — that needs the shared-DragContext work
    // (dnd/spec.md TODO).
    const memberIds = (membersByColumn().get(colKey) ?? []).map((it) => it.id);
    const remaining = memberIds.filter((id) => !keySet.has(id));
    let anchor: string | null | undefined;
    const parentEl = el.querySelector<HTMLElement>(".dnd-parent");
    if (parentEl && remaining.length > 0) {
      const rect = parentEl.getBoundingClientRect();
      const slot = Math.max(
        0,
        Math.floor((ce.detail.y - rect.top + parentEl.scrollTop) / CARD_HEIGHT),
      );
      anchor =
        slot < remaining.length
          ? remaining[slot]
          : planAnchor(memberIds, keySet, null);
    } else {
      anchor = planAnchor(memberIds, keySet, null);
    }
    dropIntoColumn(colKey, inOrder, anchor);
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
        members={() => membersByColumn().get(DEFAULT_COL) ?? []}
        onRename={(name) => app.setDefaultColumnName(props.listId, name)}
        onReorder={(op) => reorderWithin(DEFAULT_COL, op)}
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
            members={() => membersByColumn().get(col.id) ?? []}
            onRename={(name) => {
              if (name.length > 0) app.renameColumn(props.listId, col.id, name);
            }}
            onReorder={(op) => reorderWithin(col.id, op)}
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
  members: () => ItemView[];
  onRename: (name: string) => void;
  onReorder: (op: DndOp<ItemView>) => void;
  onOpen: (id: string, focus?: "notes") => void;
  openOnTap: () => boolean;
  duplicateBlock: (sourceIds: readonly string[]) => void;
  copyBlock: (sourceIds: readonly string[]) => void;
  /** User columns only — the default column can't move or be deleted. */
  menu?: {
    moveLeft?: () => void;
    moveRight?: () => void;
    delete: () => void;
  };
}) {
  const { m } = useAppI18n();
  const app = props.app;
  // Per-column selection: cross-column multi-select isn't supported —
  // each Dnd owns its own order and the models would fight over one
  // shared handle.
  const selection = new DndSelection();
  const [dndItems, setDndItems] = createSignal<ItemView[]>([]);
  createEffect(() => setDndItems(props.members()));
  let startRename: (() => void) | undefined;

  let addInput: HTMLInputElement | undefined;
  const commitAdd = () => {
    const text = addInput?.value.trim() ?? "";
    if (text.length === 0) return;
    if (addInput) addInput.value = "";
    if (props.colKey === DEFAULT_COL) {
      // Appends to the list end with no register — the default column's
      // tail by construction.
      app.addItem(props.listId, text);
    } else {
      app.addItemInColumn(props.listId, props.colKey, text);
    }
  };

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
          items={dndItems()}
          setItems={setDndItems}
          getKey={(it) => it.id}
          selection={selection}
          itemHeight={CARD_HEIGHT}
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
            />
          )}
        </Dnd>
      </div>
      <form
        class="board-col-add"
        onSubmit={(e) => {
          e.preventDefault();
          commitAdd();
        }}
      >
        <input
          ref={addInput}
          class="board-col-add-input"
          placeholder={m().common.add}
        />
      </form>
    </section>
  );
}
