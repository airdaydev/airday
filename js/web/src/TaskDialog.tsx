// The "open task" detail surface: a centered dialog (full-screen sheet on
// mobile) driven purely by an item id, so the same component can later back
// a native detached window. Notes live here only — the inline row editor is
// text-only "quick entry". Edits are buffered locally and flushed to the
// engine on close and before stepping to a neighbour (last-write-on-close
// wins; live peer edits while open are intentionally ignored, matching the
// old inline notes editor).

import { Dialog } from "@kobalte/core/dialog";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { DueField } from "./DueField.tsx";
import { ListPicker, type ListOption } from "./ListPicker.tsx";
import dotsVerticalSvg from "./icons/dots-vertical.svg?raw";
import drawingPinSvg from "./icons/drawing-pin.svg?raw";
import drawingPinFilledSvg from "./icons/drawing-pin-filled.svg?raw";
import { formatDialogStamp, nowMs } from "./format.tsx";
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

export function TaskDialog(props: {
  /** The open item's id, or null when closed. */
  itemId: () => string | null;
  setItemId: (id: string | null) => void;
  /** New-item mode: a target lane to capture into (`live: true` = Live,
   *  `false` = Backlog / list view). Mutually exclusive with `itemId`;
   *  nothing is written until a non-empty title is committed on close.
   *  `index`, when set, inserts at that position in the list's Open
   *  projection (Space capture below a board card); omitted appends. */
  newItem?: () => {
    listId: string;
    live: boolean;
    index?: number;
    /** Log an already-completed item: created open, marked done on commit. */
    done?: boolean;
  } | null;
  setNewItem?: (
    v: {
      listId: string;
      live: boolean;
      index?: number;
      done?: boolean;
    } | null,
  ) => void;
  app: DocApp;
  /** Active (non-archived) user lists — the move/capture destinations. */
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

  // Whether the open item currently has a visible Focus ref (spec/focus.md).
  const focused = createMemo(() => {
    const id = props.itemId();
    return id ? props.app.state.focusOrder.includes(id) : false;
  });
  const toggleFocus = () => {
    const id = props.itemId();
    if (!id) return;
    if (focused()) props.app.removeFromFocus(id);
    else props.app.addToFocus(id);
  };

  // If the open item vanishes (deleted here or by a peer), close.
  createEffect(() => {
    if (props.itemId() !== null && !item()) props.setItemId(null);
  });

  // Move-to-list options: Inbox followed by every *active* user list —
  // archived lists are not offered as destinations. If the open item's
  // home list is itself archived, it is appended so the picker still
  // renders the current list's name (and moving *out* to an active list
  // remains possible).
  const listOptions = createMemo<ListOption[]>(() => {
    const opts: ListOption[] = [
      { id: "inbox", name: m().nav.inbox },
      ...props.lists().map((l) => ({ id: l.id, name: l.name, icon: l.icon })),
    ];
    const currentId = item()?.listId;
    if (currentId && !opts.some((o) => o.id === currentId)) {
      const current = props.app.state.listsById[currentId];
      if (current) {
        opts.push({ id: current.id, name: current.name, icon: current.icon });
      }
    }
    return opts;
  });
  const moveItemToList = (targetId: string, currentListId: string) => {
    const id = props.itemId();
    if (!id || targetId === currentListId) return;
    const idx = props.app.state.listOpen[targetId]?.length ?? 0;
    props.app.moveItem(id, targetId, idx);
  };

  // The list option a new item is currently targeting (drives the header
  // picker's selected value).
  const newItemListOption = createMemo<ListOption | null>(() => {
    const nw = newItemTarget();
    if (!nw) return null;
    return listOptions().find((o) => o.id === nw.listId) ?? null;
  });
  // Re-target a new-item capture at a different list. The insert index is
  // dropped — a position in the old list's Open projection is meaningless in
  // the new one, so the item appends.
  const setNewItemList = (targetId: string) => {
    const nw = newItemTarget();
    if (!nw || targetId === nw.listId) return;
    props.setNewItem?.({ listId: targetId, live: nw.live, done: nw.done });
  };
  // Toggle whether a new capture is logged as already-done.
  const setNewItemDone = (done: boolean) => {
    const nw = newItemTarget();
    if (!nw) return;
    props.setNewItem?.({ ...nw, done });
  };

  const [text, setText] = createSignal("");
  const [notes, setNotes] = createSignal("");
  // New-item mode's due-date buffer: nothing exists to write to until the
  // capture commits, so picks are held here and applied after creation.
  const [newDueOn, setNewDueOn] = createSignal<string | null>(null);
  // New-item mode's pin-to-Focus buffer, same deal as `newDueOn`.
  const [newFocus, setNewFocus] = createSignal(false);
  // Due-date calendar popover open state, shared by both DueField modes.
  const [dueCalOpen, setDueCalOpen] = createSignal(false);
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
    if (!el) return;
    setLinkifiedText(el, value);
    ensureTrailingBreak(el);
  };

  // A "\n" at the very end of a pre-wrap block doesn't get its own line
  // box, so the caret has nowhere to land after a trailing newline. A
  // trailing <br> gives it one; textContent ignores <br>, so the saved
  // string is unaffected.
  const ensureTrailingBreak = (el: HTMLDivElement) => {
    if (!(el.textContent ?? "").endsWith("\n")) return;
    if (el.lastChild instanceof HTMLBRElement) return;
    el.appendChild(document.createElement("br"));
  };

  // Replace the selection inside `el` with a literal "\n" text node. Done by
  // hand rather than execCommand("insertText", "\n") because WebKit (every
  // iOS browser) treats that as a block split or drops it, so the newline
  // never reaches textContent and never saves. Returns false when the
  // selection isn't inside `el`.
  const insertNewline = (el: HTMLDivElement | undefined): boolean => {
    if (!el) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return false;
    range.deleteContents();
    const nl = document.createTextNode("\n");
    range.insertNode(nl);
    range.setStartAfter(nl);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    ensureTrailingBreak(el);
    setNotes(editorText(el));
    return true;
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
    setNewDueOn(null);
    setNewFocus(false);
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

  // Commit new-item mode: create the item in its target lane (Live when
  // `live`, else Backlog) iff the title is non-empty, then close. A capture
  // without an explicit slot lands at the TOP of the lane (index 0) —
  // matching the list view's inline-draft default — rather than appending.
  const commitNew = () => {
    const nw = newItemTarget();
    if (nw) {
      const t = editorText(titleRef).trim();
      if (t) {
        const at = nw.index ?? 0;
        const id = nw.live
          ? props.app.addItemLiveAt(nw.listId, t, at)
          : props.app.addItemAt(nw.listId, t, at);
        const n = editorText(notesRef);
        if (n.trim()) props.app.editItemNotes(id, n);
        const d = newDueOn();
        if (d) props.app.setItemDueOn(id, d);
        // A Done capture can't hold a Focus ref (auto-remove-on-Done,
        // spec/focus.md), so the pin buffer only applies to open captures.
        if (newFocus() && !nw.done) props.app.addToFocus(id);
        // Logged-as-done capture: create open, then mark done in a second op
        // (mirrors a drag-into-Done). Stamps doneAt = now.
        if (nw.done) props.app.setDone(id, true);
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
      insertNewline(notesRef);
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

  // iOS soft keyboards can deliver Return without a keydown the handler
  // above sees (or with key "Unidentified"); the editing intent still
  // arrives here as insertParagraph / insertLineBreak. Swap the default
  // block split for the same literal newline.
  const onNotesBeforeInput = (e: InputEvent) => {
    if (
      e.inputType !== "insertParagraph" &&
      e.inputType !== "insertLineBreak"
    )
      return;
    if (e.isComposing) return;
    if (insertNewline(notesRef)) e.preventDefault();
  };

  // Land the caret on open: the title (or notes when asked), at the
  // pointed-at offset for a double-click. rAF defers past the load effect
  // that linkifies the title value.
  const focusOnOpen = () => {
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
  };

  // Cmd/Ctrl+Enter anywhere in the surface = save & close. The page shell
  // (mobile) also takes Escape, which Kobalte handles for the dialog.
  const onShellKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Escape" && isMobile()) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  // The surface body, shared by both shells below.
  const body = () => (
    <>
    <Show when={isNew()}>
      <header class="task-dialog-header">
        <div class="task-dialog-header-meta">
          {/* Checked = this capture is logged as already-done. Pre-set
              by the Done lane "+" and the Done view's "Log" button;
              flip it off to file the item as a normal open task. */}
          <input
            type="checkbox"
            class="task-check"
            checked={newItemTarget()?.done ?? false}
            aria-label={
              newItemTarget()?.done
                ? m().workspace.markNotDone
                : m().workspace.markDone
            }
            onChange={(e) => setNewItemDone(e.currentTarget.checked)}
          />
          {/* Stamp mirroring the edit dialog's created/completed
              text: names the checkbox's current meaning. */}
          <span class="task-dialog-created">
            {newItemTarget()?.done
              ? m().workspace.loggingDoneStamp
              : m().workspace.newItemStamp}
          </span>
        </div>
        <div class="task-dialog-header-actions">
          <button
            type="button"
            class="task-dialog-close"
            aria-label={m().common.close}
            onClick={close}
          >
            ✕
          </button>
        </div>
      </header>
      <div class="task-dialog-body">
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
            data-done={newItemTarget()?.done ? "" : undefined}
            data-placeholder={
              newItemTarget()?.done
                ? m().workspace.logCompleted
                : m().board.addItem
            }
            onInput={() => setText(editorText(titleRef))}
            onKeyDown={onTitleKeyDown}
            onPaste={pasteAsPlainText}
            onClick={(e) => openLinkOnClick(e, titleRef)}
          />
          {/* List selector leads the badge row, then the due-date
              badge; picks land in the local buffers and are written
              after the item commits. The pin toggle buffers the
              same way (`newFocus`). */}
          <div class="task-dialog-badges">
            <ListPicker
              options={listOptions}
              value={() => newItemListOption()?.id ?? null}
              onChange={setNewItemList}
            />
            <DueField
              dueOn={newDueOn}
              muted={() => newItemTarget()?.done ?? false}
              onChange={setNewDueOn}
              open={dueCalOpen}
              setOpen={setDueCalOpen}
            />
            <PinToggle
              pinned={newFocus}
              disabled={() => newItemTarget()?.done ?? false}
              onToggle={() => setNewFocus((v) => !v)}
            />
          </div>
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
            on:beforeinput={onNotesBeforeInput}
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
              <input
                type="checkbox"
                class="task-check"
                checked={isDone(it())}
                onChange={(e) =>
                  props.app.setDone(it().id, e.currentTarget.checked)
                }
              />
              {/* Created stamp, swapping to the completion stamp
                  once the item is ticked off. */}
              <span class="task-dialog-created">
                {isDone(it())
                  ? m().workspace.completedStamp(
                      formatDialogStamp(it().doneAt!, nowMs(), locale(), { inline: true }),
                    )
                  : m().workspace.createdStamp(
                      formatDialogStamp(it().createdAt, nowMs(), locale(), { inline: true }),
                    )}
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
              <button
                type="button"
                class="task-dialog-close"
                aria-label={m().common.close}
                onClick={close}
              >
                ✕
              </button>
            </div>
          </header>

          <div class="task-dialog-body">
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

          {/* Badge row: the move-to-list picker first, then the
              always-visible due-date badge — clicking it opens a
              quick popover (Set date… / Tomorrow / Remove date).
              The pin toggle beside it adds / removes the Focus ref;
              disabled on Done / Binned items, which can't hold one
              (spec/focus.md). */}
          <div class="task-dialog-badges">
            <ListPicker
              options={listOptions}
              value={() => it().listId}
              onChange={(id) => moveItemToList(id, it().listId)}
            />
            <DueField
              dueOn={() => it().dueOn ?? null}
              muted={() => isDone(it()) || isBinned(it())}
              onChange={(stamp) =>
                props.app.setItemDueOn(it().id, stamp)
              }
              open={dueCalOpen}
              setOpen={setDueCalOpen}
            />
            <PinToggle
              pinned={focused}
              disabled={() => isDone(it()) || isBinned(it())}
              onToggle={toggleFocus}
            />
          </div>

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
            on:beforeinput={onNotesBeforeInput}
            onPaste={pasteAsPlainText}
            onClick={(e) => openLinkOnClick(e, notesRef)}
          />

          {/* The done stamp lives in the header now; only the bin
              stamp still needs a meta row. */}
          <Show when={isBinned(it())}>
            <div class="task-dialog-meta">
              <div class="task-dialog-meta-row">
                <span class="task-dialog-meta-label">
                  {m().nav.bin}
                </span>
                <span>
                  {formatDialogStamp(it().binnedAt!, nowMs(), locale())}
                </span>
              </div>
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
    </>
  );

  // Two shells around one body. Desktop: a centred modal Dialog (focus
  // trap, overlay, Escape from Kobalte). Mobile: a plain full-screen page
  // under the floating pills — no modal, no portal, so the pills stay
  // live and nothing counts as an "outside" interaction.
  const isMobileMq = window.matchMedia("(max-width: 768px) and (pointer: coarse)");
  const [isMobile, setIsMobile] = createSignal(isMobileMq.matches);
  const onMq = (e: MediaQueryListEvent) => setIsMobile(e.matches);
  isMobileMq.addEventListener("change", onMq);
  onCleanup(() => isMobileMq.removeEventListener("change", onMq));

  // Page shell: focus the editor on open (Kobalte does this for the
  // dialog via onOpenAutoFocus) and hand focus back on close.
  createEffect(() => {
    if (!isMobile()) return;
    if (!open()) return;
    focusOnOpen();
    onCleanup(() => props.onClosed?.());
  });

  return (
    <Show
      when={!isMobile()}
      fallback={
        <Show when={open()}>
          <section
            class="task-dialog task-page"
            role="region"
            aria-label={m().common.close}
            onKeyDown={onShellKeyDown}
          >
            {body()}
          </section>
        </Show>
      }
    >
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
              onKeyDown={onShellKeyDown}
              onCloseAutoFocus={(e) => {
                // Kobalte would restore focus to whatever opened the dialog
                // (a row's open icon, the note badge, …). Take over and send
                // focus to the list so keyboard nav resumes there.
                e.preventDefault();
                props.onClosed?.();
              }}
              onOpenAutoFocus={(e) => {
                // Kobalte would focus the first tabbable (the close button);
                // take over and land the caret.
                e.preventDefault();
                focusOnOpen();
              }}
            >
              {body()}
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>
    </Show>
  );
}

/** Pin-to-Focus toggle shown beside the due-date badge: outline pin when
 *  unpinned, filled when pinned. Backed by live Focus state for open items
 *  and by the `newFocus` buffer in new-item capture mode. */
function PinToggle(props: {
  pinned: () => boolean;
  disabled: () => boolean;
  onToggle: () => void;
}) {
  const { m } = useAppI18n();
  const label = () => (props.pinned() ? m().focus.remove : m().focus.add);
  return (
    <button
      type="button"
      class="badge task-dialog-pin-toggle"
      aria-pressed={props.pinned()}
      aria-label={label()}
      title={label()}
      disabled={props.disabled()}
      onClick={props.onToggle}
      innerHTML={props.pinned() ? drawingPinFilledSvg : drawingPinSvg}
    />
  );
}
