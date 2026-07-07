// The "open task" detail surface: a centered dialog (full-screen sheet on
// mobile) driven purely by an item id, so the same component can later back
// a native detached window. Notes live here only — the inline row editor is
// text-only "quick entry". Edits are buffered locally and flushed to the
// engine on close and before stepping to a neighbour (last-write-on-close
// wins; live peer edits while open are intentionally ignored, matching the
// old inline notes editor).

import { Dialog } from "@kobalte/core/dialog";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Select } from "@kobalte/core/select";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import caretSortSvg from "./icons/caret-sort.svg?raw";
import dotsVerticalSvg from "./icons/dots-vertical.svg?raw";
import {
  addDaysToStamp,
  formatDoneStamp,
  formatRelative,
  nowMs,
  todayStamp,
} from "./format.tsx";
import { useAppI18n } from "./i18n.tsx";
import {
  collapsedCaretOffset,
  locateOffsetInLinkified,
  openLinkOnClick,
  placeCaretAtEnd,
  placeCaretAtStart,
  setLinkifiedText,
} from "./linkify.ts";
import { pasteAsPlainText } from "./plainTextPaste.ts";
import { trackOverlay } from "./overlay.ts";
import {
  isBinned,
  isDone,
  type DocApp,
  type ItemView,
  type ListView,
} from "./sync/store.ts";

// One entry in the header's move-to-list Select: the reserved `main` list
// plus every user list, `{ id, name }`.
type ListOption = { id: string; name: string };

export function TaskDialog(props: {
  /** The open item's id, or null when closed. */
  itemId: () => string | null;
  setItemId: (id: string | null) => void;
  /** New-item mode: a target column to capture into (`columnId: null` = the
   *  list's default column / list view). Mutually exclusive with `itemId`;
   *  nothing is written until a non-empty title is committed on close.
   *  `index`, when set, inserts at that position in the list's linear live
   *  projection (Space capture below a board card); omitted appends. */
  newItem?: () => {
    listId: string;
    columnId: string | null;
    index?: number;
  } | null;
  setNewItem?: (v: null) => void;
  app: DocApp;
  /** Resolved display name for the reserved `main` list. */
  homeName: () => string;
  lists: () => ListView[];
  /** Which field to focus on open (default title). */
  focusField?: () => "title" | "notes";
  /** Title character offset to land the caret at on open (from a
   *  double-click); null/undefined → caret at the end of the title. */
  caret?: () => number | null;
  /** Called as the dialog closes so the owner can restore focus (to the
   *  list). Fires from Kobalte's close-auto-focus hook, which we take over
   *  to steer focus back to the listbox instead of the trigger. */
  onClosed?: () => void;
  /** Pushes the in-progress title into a UI-only channel so the list row
   *  mirrors the edit live — without a sync op per keystroke. The real
   *  write still happens once, via the close/flush path. */
  onLiveText?: (text: string) => void;
  /** Fires with the id of a freshly committed new item, so the caller can
   *  select/scroll to it (used by the board's "+" capture). */
  onCreated?: (id: string) => void;
}) {
  const { m, locale } = useAppI18n();

  const newItemTarget = createMemo(() => props.newItem?.() ?? null);
  const isNew = createMemo(
    () => props.itemId() === null && newItemTarget() !== null,
  );
  const open = createMemo(
    () => props.itemId() !== null || newItemTarget() !== null,
  );
  trackOverlay(open);

  const item = createMemo<ItemView | undefined>(() => {
    const id = props.itemId();
    return id ? props.app.state.itemsById[id] : undefined;
  });

  // If the open item vanishes (deleted here or by a peer), close.
  createEffect(() => {
    if (props.itemId() !== null && !item()) props.setItemId(null);
  });

  // Move-to-list options: Home (main) followed by every user list.
  const listOptions = createMemo<ListOption[]>(() => [
    { id: "main", name: props.homeName() },
    ...props.lists().map((l) => ({ id: l.id, name: l.name })),
  ]);
  const moveItemToList = (targetId: string, currentListId: string) => {
    const id = props.itemId();
    if (!id || targetId === currentListId) return;
    const idx = props.app.state.listLive[targetId]?.length ?? 0;
    props.app.moveItem(id, targetId, idx);
  };

  // Display name of the list a new item is being captured into.
  const newItemListName = createMemo((): string => {
    const nw = newItemTarget();
    if (!nw) return "";
    return listOptions().find((o) => o.id === nw.listId)?.name ?? nw.listId;
  });

  const [text, setText] = createSignal("");
  const [notes, setNotes] = createSignal("");
  // The title and notes editors are contenteditable (not textareas) so that
  // http(s) URLs render as clickable anchors, matching the row quick-entry
  // editor. Their content is set imperatively from the buffers on load — it
  // is never value-bound, so reactive updates can't clobber a live caret.
  let titleRef: HTMLDivElement | undefined;
  let notesRef: HTMLDivElement | undefined;

  // Which id the buffers currently hold. A plain var (not a signal): it's
  // written from the load effect, never read reactively.
  let loadedId: string | null = null;

  // Read the plain text out of a contenteditable editor, stripping the stray
  // <br> browsers leave behind when the last character is deleted so the
  // :empty placeholder returns.
  const editorText = (el?: HTMLDivElement): string => {
    if (!el) return "";
    if (el.textContent === "" && el.firstChild) el.replaceChildren();
    return el.textContent ?? "";
  };

  // Push a buffer value into a contenteditable editor as linkified content.
  const loadEditor = (el: HTMLDivElement | undefined, value: string) => {
    if (el) setLinkifiedText(el, value);
  };

  // Write the current editor contents back to `id` if they differ. Empty
  // title is ignored (keep the existing text), mirroring the inline editor.
  const flush = (id: string | null) => {
    if (!id) return;
    const it = props.app.state.itemsById[id];
    if (!it) return;
    const t = editorText(titleRef).trim();
    if (t && t !== it.text) props.app.editItemText(id, t);
    const n = editorText(notesRef);
    if (n !== it.notes) props.app.editItemNotes(id, n);
  };

  // Load the buffers and the editor DOM when the open target changes (an
  // item, or a fresh new-item capture). Content is set imperatively — never
  // value-bound — so reactive re-renders can't clobber a live caret. No
  // flush here; every transition that swaps the target flushes first.
  createEffect(() => {
    const id = props.itemId();
    const nw = newItemTarget();
    const key = id ?? (nw ? "new" : null);
    if (key === null || key === loadedId) return;
    const it = id ? props.app.state.itemsById[id] : undefined;
    const t = it?.text ?? "";
    const n = it?.notes ?? "";
    setText(t);
    setNotes(n);
    loadedId = key;
    // The editors mount when the dialog opens; defer so their refs exist,
    // then push — but only if this target is still the one showing.
    queueMicrotask(() => {
      const curId = props.itemId();
      const curKey = curId ?? (props.newItem?.() ? "new" : null);
      if (curKey !== key) return;
      loadEditor(titleRef, t);
      loadEditor(notesRef, n);
    });
  });

  // The editors unmount on close; forget the loaded target so reopening the
  // same item re-pushes its content into the freshly mounted editors.
  createEffect(() => {
    if (!open()) loadedId = null;
  });

  // Commit new-item mode: create the item in its target column (default
  // column when `columnId` is null) iff the title is non-empty, then close.
  const commitNew = () => {
    const nw = newItemTarget();
    if (nw) {
      const t = editorText(titleRef).trim();
      if (t) {
        const id =
          nw.index != null
            ? props.app.addItemInColumnAt(nw.listId, nw.columnId, t, nw.index)
            : nw.columnId
              ? props.app.addItemInColumn(nw.listId, nw.columnId, t)
              : props.app.addItem(nw.listId, t);
        const n = editorText(notesRef);
        if (n.trim()) props.app.editItemNotes(id, n);
        props.onCreated?.(id);
      }
    }
    props.setNewItem?.(null);
  };

  const close = () => {
    if (isNew()) {
      commitNew();
      return;
    }
    flush(loadedId);
    props.setItemId(null);
  };

  // Title/notes keyboard nav, shared by the edit and new-item forms. The
  // editors are contenteditable, so "caret at start/end" is derived from
  // the collapsed selection offset rather than textarea selection props.
  const onTitleKeyDown = (e: KeyboardEvent) => {
    // Enter commits & closes (the title is one line); Shift+Enter is left
    // to the browser, but the title never wraps to multiple lines in use.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.isComposing
    ) {
      e.preventDefault();
      close();
      return;
    }
    // ArrowDown at the very end of the title drops into the notes field.
    if (
      e.key !== "ArrowDown" ||
      e.shiftKey ||
      e.altKey ||
      e.metaKey ||
      e.ctrlKey ||
      e.isComposing ||
      !titleRef ||
      !notesRef
    )
      return;
    const off = collapsedCaretOffset(titleRef);
    if (off === null || off !== (titleRef.textContent?.length ?? 0)) return;
    e.preventDefault();
    placeCaretAtStart(notesRef);
  };
  const onNotesKeyDown = (e: KeyboardEvent) => {
    // Plain Enter inserts a real newline character (kept as text so
    // textContent round-trips on save), instead of the default block split.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.isComposing
    ) {
      e.preventDefault();
      document.execCommand("insertText", false, "\n");
      setNotes(editorText(notesRef));
      return;
    }
    // ArrowUp at the very start of the notes jumps back up to the title.
    if (
      e.key !== "ArrowUp" ||
      e.shiftKey ||
      e.altKey ||
      e.metaKey ||
      e.ctrlKey ||
      e.isComposing ||
      !titleRef ||
      !notesRef
    )
      return;
    const off = collapsedCaretOffset(notesRef);
    if (off === null || off !== 0) return;
    e.preventDefault();
    placeCaretAtEnd(titleRef);
  };

  return (
    <Dialog
      open={open()}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      modal
    >
      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay" />
        <div class="dialog-positioner">
          <Dialog.Content
            class="task-dialog"
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter anywhere in the dialog = save & close.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                close();
              }
            }}
            onCloseAutoFocus={(e) => {
              // Kobalte would restore focus to whatever opened the dialog
              // (a row's open icon, the note badge, …). Take over and send
              // focus to the list so keyboard nav resumes there.
              e.preventDefault();
              props.onClosed?.();
            }}
            onOpenAutoFocus={(e) => {
              // Kobalte would focus the first tabbable (the close button);
              // take over and land the caret. rAF defers past the load
              // effect that linkifies the title value.
              e.preventDefault();
              requestAnimationFrame(() => {
                const toNotes = props.focusField?.() === "notes";
                const el = toNotes ? notesRef : titleRef;
                if (!el) return;
                // A double-click passes a title caret offset — place it
                // exactly where the user pointed (mapped through the
                // linkified anchors); otherwise land at the end.
                const caret = toNotes ? null : (props.caret?.() ?? null);
                if (caret === null) {
                  placeCaretAtEnd(el);
                  return;
                }
                el.focus();
                const pos = locateOffsetInLinkified(el, caret);
                const sel = window.getSelection();
                const range = document.createRange();
                range.setStart(pos.node, pos.offset);
                range.collapse(true);
                sel?.removeAllRanges();
                sel?.addRange(range);
              });
            }}
          >
            <Show when={isNew()}>
              <header class="task-dialog-header">
                <div class="task-dialog-header-meta">
                  <span class="task-dialog-list-value">
                    {newItemListName()}
                  </span>
                </div>
                <div class="task-dialog-header-actions">
                  <Dialog.CloseButton
                    class="task-dialog-close"
                    aria-label={m().common.close}
                  >
                    ✕
                  </Dialog.CloseButton>
                </div>
              </header>
              <div class="task-dialog-body">
                <div class="task-dialog-gutter" />
                <div class="task-dialog-content">
                  <div
                    ref={(el) => {
                      titleRef = el;
                      // Set the literal attribute value (not Solid's folded
                      // valueless `contenteditable`) so the workspace's
                      // `[contenteditable="true"]` shortcut guard matches.
                      el.setAttribute("contenteditable", "true");
                      setLinkifiedText(el, text());
                    }}
                    class="task-dialog-title"
                    role="textbox"
                    data-placeholder={m().board.addItem}
                    onInput={() => setText(editorText(titleRef))}
                    onKeyDown={onTitleKeyDown}
                    onPaste={pasteAsPlainText}
                    onClick={(e) => openLinkOnClick(e, titleRef)}
                  />
                  <div
                    ref={(el) => {
                      notesRef = el;
                      el.setAttribute("contenteditable", "true");
                      setLinkifiedText(el, notes());
                    }}
                    class="task-dialog-notes"
                    role="textbox"
                    aria-multiline="true"
                    data-placeholder={m().workspace.notes}
                    onInput={() => setNotes(editorText(notesRef))}
                    onKeyDown={onNotesKeyDown}
                    onPaste={pasteAsPlainText}
                    onClick={(e) => openLinkOnClick(e, notesRef)}
                  />
                </div>
              </div>
            </Show>
            <Show when={item()}>
              {(it) => (
                <>
                  <header class="task-dialog-header">
                    <div class="task-dialog-header-meta">
                      <Select<ListOption>
                        placement="bottom-start"
                        gutter={4}
                        options={listOptions()}
                        optionValue="id"
                        optionTextValue="name"
                        value={
                          listOptions().find((o) => o.id === it().listId) ??
                          null
                        }
                        onChange={(opt) => {
                          if (opt) moveItemToList(opt.id, it().listId);
                        }}
                        itemComponent={(iprops) => (
                          <Select.Item item={iprops.item} class="select-item">
                            <Select.ItemLabel>
                              {iprops.item.rawValue.name}
                            </Select.ItemLabel>
                          </Select.Item>
                        )}
                      >
                        <Select.Trigger
                          class="task-dialog-list"
                          aria-label={m().workspace.moveToList}
                        >
                          <Select.Value<ListOption> class="task-dialog-list-value">
                            {(state) => state.selectedOption()?.name}
                          </Select.Value>
                          <span
                            class="task-dialog-list-caret"
                            aria-hidden="true"
                            innerHTML={caretSortSvg}
                          />
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Content class="select-content task-dialog-menu-content">
                            <Select.Listbox class="select-listbox" />
                          </Select.Content>
                        </Select.Portal>
                      </Select>
                      <span class="task-dialog-created">
                        {formatRelative(it().createdAt, nowMs(), locale())}
                      </span>
                    </div>
                    <div class="task-dialog-header-actions">
                      <Show when={!isBinned(it())}>
                        <DropdownMenu>
                          <DropdownMenu.Trigger
                            class="nav-menu-trigger"
                            aria-label={m().common.menu}
                            innerHTML={dotsVerticalSvg}
                          />
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content class="dropdown-menu-content task-dialog-menu-content">
                              <DropdownMenu.Item
                                class="dropdown-menu-item"
                                onSelect={() => {
                                  props.app.setBinnedMany([it().id], true);
                                  props.setItemId(null);
                                }}
                              >
                                {m().workspace.moveToBin}
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </Show>
                      <Dialog.CloseButton
                        class="task-dialog-close"
                        aria-label={m().common.close}
                      >
                        ✕
                      </Dialog.CloseButton>
                    </div>
                  </header>

                  <div class="task-dialog-body">
                    <div class="task-dialog-gutter">
                      <input
                        type="checkbox"
                        class="task-dialog-check"
                        checked={isDone(it())}
                        onChange={(e) =>
                          props.app.setDone(it().id, e.currentTarget.checked)
                        }
                      />
                    </div>
                    <div class="task-dialog-content">
                      <div
                        ref={(el) => {
                          titleRef = el;
                          el.setAttribute("contenteditable", "true");
                          setLinkifiedText(el, text());
                        }}
                        class="task-dialog-title"
                      role="textbox"
                      data-done={isDone(it()) ? "" : undefined}
                      onInput={() => {
                        const v = editorText(titleRef);
                        setText(v);
                        props.onLiveText?.(v);
                      }}
                      onKeyDown={onTitleKeyDown}
                      onPaste={pasteAsPlainText}
                      onClick={(e) => openLinkOnClick(e, titleRef)}
                    />

                  <div
                    ref={(el) => {
                      notesRef = el;
                      el.setAttribute("contenteditable", "true");
                      setLinkifiedText(el, notes());
                    }}
                    class="task-dialog-notes"
                    role="textbox"
                    aria-multiline="true"
                    data-placeholder={m().workspace.notes}
                    onInput={() => setNotes(editorText(notesRef))}
                    onKeyDown={onNotesKeyDown}
                    onPaste={pasteAsPlainText}
                    onClick={(e) => openLinkOnClick(e, notesRef)}
                  />

                  <div class="task-dialog-due">
                    <span class="task-dialog-due-label">{m().due.label}</span>
                    <div class="task-dialog-due-controls">
                      {/* Native date picker — its value is already a raw
                          YYYY-MM-DD string, exactly what the register
                          stores. Empty value clears the due date. */}
                      <input
                        type="date"
                        class="task-dialog-due-input"
                        value={it().dueOn ?? ""}
                        onChange={(e) =>
                          props.app.setItemDueOn(
                            it().id,
                            e.currentTarget.value || null,
                          )
                        }
                      />
                      <button
                        type="button"
                        class="task-dialog-due-btn"
                        onClick={() =>
                          props.app.setItemDueOn(it().id, todayStamp(nowMs()))
                        }
                      >
                        {m().due.today}
                      </button>
                      <button
                        type="button"
                        class="task-dialog-due-btn"
                        onClick={() =>
                          props.app.setItemDueOn(
                            it().id,
                            addDaysToStamp(todayStamp(nowMs()), 1),
                          )
                        }
                      >
                        {m().due.tomorrow}
                      </button>
                      <Show when={it().dueOn}>
                        <button
                          type="button"
                          class="task-dialog-due-btn"
                          onClick={() => props.app.setItemDueOn(it().id, null)}
                        >
                          {m().due.clear}
                        </button>
                      </Show>
                    </div>
                  </div>

                  <Show when={isDone(it()) || isBinned(it())}>
                    <div class="task-dialog-meta">
                      <Show when={isDone(it())}>
                        <div class="task-dialog-meta-row">
                          <span class="task-dialog-meta-label">
                            {m().nav.done}
                          </span>
                          <span>
                            {formatDoneStamp(it().doneAt!, nowMs(), locale())}
                          </span>
                        </div>
                      </Show>
                      <Show when={isBinned(it())}>
                        <div class="task-dialog-meta-row">
                          <span class="task-dialog-meta-label">
                            {m().nav.bin}
                          </span>
                          <span>
                            {formatRelative(it().binnedAt!, nowMs(), locale())}
                          </span>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <Show when={isBinned(it())}>
                    <div class="task-dialog-actions">
                      <span class="task-dialog-actions-spacer" />
                      <button
                        type="button"
                        class="task-dialog-btn"
                        onClick={() => {
                          props.app.setBinnedMany([it().id], false);
                          props.setItemId(null);
                        }}
                      >
                        {m().common.restore}
                      </button>
                      <button
                        type="button"
                        class="task-dialog-btn destructive"
                        onClick={() => {
                          props.app.deleteBinnedMany([it().id]);
                          props.setItemId(null);
                        }}
                      >
                        {m().common.delete}
                      </button>
                    </div>
                  </Show>
                    </div>
                  </div>
                </>
              )}
            </Show>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
