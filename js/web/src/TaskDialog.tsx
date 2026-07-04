// The "open task" detail surface: a centered dialog (full-screen sheet on
// mobile) driven purely by an item id, so the same component can later back
// a native detached window. Notes live here only — the inline row editor is
// text-only "quick entry". Edits are buffered locally and flushed to the
// engine on close and before stepping to a neighbour (last-write-on-close
// wins; live peer edits while open are intentionally ignored, matching the
// old inline notes editor).

import { Dialog } from "@kobalte/core/dialog";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import dotsVerticalSvg from "./icons/dots-vertical.svg?raw";
import { formatDoneStamp, formatRelative, nowMs } from "./format.tsx";
import { useAppI18n } from "./i18n.tsx";
import { trackOverlay } from "./overlay.ts";
import {
  isBinned,
  isDone,
  isInListView,
  type DocApp,
  type ItemView,
  type ListView,
} from "./sync/store.ts";

export function TaskDialog(props: {
  /** The open item's id, or null when closed. */
  itemId: () => string | null;
  setItemId: (id: string | null) => void;
  app: DocApp;
  /** Resolved display name for the reserved `main` list. */
  homeName: () => string;
  lists: () => ListView[];
  /** Called as the dialog closes so the owner can restore focus (to the
   *  list). Fires from Kobalte's close-auto-focus hook, which we take over
   *  to steer focus back to the listbox instead of the trigger. */
  onClosed?: () => void;
  /** Pushes the in-progress title into a UI-only channel so the list row
   *  mirrors the edit live — without a sync op per keystroke. The real
   *  write still happens once, via the close/flush path. */
  onLiveText?: (text: string) => void;
}) {
  const { m, locale } = useAppI18n();
  trackOverlay(() => props.itemId() !== null);

  const item = createMemo<ItemView | undefined>(() => {
    const id = props.itemId();
    return id ? props.app.state.itemsById[id] : undefined;
  });

  // If the open item vanishes (deleted here or by a peer), close.
  createEffect(() => {
    if (props.itemId() !== null && !item()) props.setItemId(null);
  });

  const [text, setText] = createSignal("");
  const [notes, setNotes] = createSignal("");
  let titleRef: HTMLTextAreaElement | undefined;
  let notesRef: HTMLTextAreaElement | undefined;

  // Which id the buffers currently hold. A plain var (not a signal): it's
  // written from the load effect, never read reactively.
  let loadedId: string | null = null;

  // Match textarea height to content so notes grow instead of scrolling.
  const autosize = (el?: HTMLTextAreaElement) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Write the current buffers back to `id` if they differ. Empty title is
  // ignored (keep the existing text), mirroring the inline editor.
  const flush = (id: string | null) => {
    if (!id) return;
    const it = props.app.state.itemsById[id];
    if (!it) return;
    const t = text().trim();
    if (t && t !== it.text) props.app.editItemText(id, t);
    if (notes() !== it.notes) props.app.editItemNotes(id, notes());
  };

  // Load buffers when the open item changes. No flush here — every
  // transition that swaps the id (step / close) flushes explicitly first.
  createEffect(() => {
    const id = props.itemId();
    if (id === loadedId) return;
    const it = id ? props.app.state.itemsById[id] : undefined;
    setText(it?.text ?? "");
    setNotes(it?.notes ?? "");
    loadedId = id;
  });

  // Re-fit the textareas after a load (stepping swaps the text under us).
  createEffect(() => {
    text();
    autosize(titleRef);
  });
  createEffect(() => {
    notes();
    autosize(notesRef);
  });

  const close = () => {
    flush(loadedId);
    props.setItemId(null);
  };

  return (
    <Dialog
      open={props.itemId() !== null}
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
            onCloseAutoFocus={(e) => {
              // Kobalte would restore focus to whatever opened the dialog
              // (a row's open icon, the note badge, …). Take over and send
              // focus to the list so keyboard nav resumes there.
              e.preventDefault();
              props.onClosed?.();
            }}
            onOpenAutoFocus={(e) => {
              // Kobalte would focus the first tabbable (the close button);
              // take over and land the caret at the end of the title so the
              // user can start typing/editing immediately. rAF defers past
              // the load effect that fills the title value.
              e.preventDefault();
              requestAnimationFrame(() => {
                const el = titleRef;
                if (!el) return;
                el.focus();
                const end = el.value.length;
                el.setSelectionRange(end, end);
              });
            }}
          >
            <Show when={item()}>
              {(it) => (
                <>
                  <header class="task-dialog-header">
                    <div class="task-dialog-header-meta">
                      <span class="task-dialog-list">
                        {it().listId === "main"
                          ? props.homeName()
                          : (props.lists().find((l) => l.id === it().listId)
                              ?.name ?? it().listId)}
                      </span>
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
                      <textarea
                        ref={(el) => {
                          titleRef = el;
                          autosize(el);
                        }}
                        class="task-dialog-title"
                      rows={1}
                      value={text()}
                      data-done={isDone(it()) ? "" : undefined}
                      onInput={(e) => {
                        const v = e.currentTarget.value;
                        setText(v);
                        autosize(e.currentTarget);
                        props.onLiveText?.(v);
                      }}
                      onKeyDown={(e) => {
                        // ArrowDown at the very end of the title drops into
                        // the notes field (caret at its start).
                        if (
                          e.key !== "ArrowDown" ||
                          e.shiftKey ||
                          e.altKey ||
                          e.metaKey ||
                          e.ctrlKey ||
                          e.isComposing
                        )
                          return;
                        const ta = e.currentTarget;
                        const end = ta.value.length;
                        if (
                          ta.selectionStart !== end ||
                          ta.selectionEnd !== end
                        )
                          return;
                        e.preventDefault();
                        notesRef?.focus();
                        notesRef?.setSelectionRange(0, 0);
                      }}
                    />

                  <textarea
                    ref={(el) => {
                      notesRef = el;
                      autosize(el);
                    }}
                    class="task-dialog-notes"
                    placeholder={m().workspace.notes}
                    rows={1}
                    value={notes()}
                    onInput={(e) => {
                      setNotes(e.currentTarget.value);
                      autosize(e.currentTarget);
                    }}
                    onKeyDown={(e) => {
                      // ArrowUp at the very start of the notes jumps back up
                      // to the title (caret at its end).
                      if (
                        e.key !== "ArrowUp" ||
                        e.shiftKey ||
                        e.altKey ||
                        e.metaKey ||
                        e.ctrlKey ||
                        e.isComposing
                      )
                        return;
                      const ta = e.currentTarget;
                      if (ta.selectionStart !== 0 || ta.selectionEnd !== 0)
                        return;
                      e.preventDefault();
                      const t = titleRef;
                      if (!t) return;
                      t.focus();
                      const end = t.value.length;
                      t.setSelectionRange(end, end);
                    }}
                  />

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

                  <Show when={isInListView(it())}>
                    <label class="task-dialog-move">
                      <span class="task-dialog-meta-label">
                        {m().workspace.moveToList}
                      </span>
                      <select
                        value={it().listId}
                        onChange={(e) => {
                          const target = e.currentTarget.value;
                          if (target === it().listId) return;
                          const idx =
                            props.app.state.listLive[target]?.length ?? 0;
                          props.app.moveItem(it().id, target, idx);
                        }}
                      >
                        <option value="main">{props.homeName()}</option>
                        <For each={props.lists()}>
                          {(l) => <option value={l.id}>{l.name}</option>}
                        </For>
                      </select>
                    </label>
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
