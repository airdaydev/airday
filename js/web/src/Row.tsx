import { createEffect, createMemo, createSignal, on, Show } from "solid-js";
import { ContextMenu } from "@kobalte/core/context-menu";
import { DndSelection } from "./dnd/solid";
import { trackOverlay } from "./overlay.ts";
import { DueBadge } from "./DueBadge.tsx";
import {
  addDaysToStamp,
  formatDoneStamp,
  formatRelative,
  nowMs,
  todayStamp,
} from "./format.tsx";
import { useAppI18n } from "./i18n.tsx";
import { pasteAsPlainText } from "./plainTextPaste.ts";
import { setLinkifiedText } from "./linkify.ts";
import type { ViewKey } from "./prefs.ts";
import {
  isBinned,
  isDone,
  isOpen,
  type DocApp,
  type ItemView,
} from "./sync/store.ts";

// Draft items live only in the dnd's items list — never in the engine —
// until the user commits them. The id prefix is the discriminator the
// Row uses to switch between "edit existing" and "create new" save paths
// on collapse.
export const DRAFT_ID_PREFIX = "__draft__";
export const isDraftId = (id: string): boolean => id.startsWith(DRAFT_ID_PREFIX);

// Surface the most recent state-changing timestamp. Binned wins over
// done because it's the later transition: a done-then-binned item shows
// when it was binned in the Bin view; a plain done item shows doneAt in
// the Done view.
function lifecycleTimestamp(it: ItemView): number | undefined {
  return it.binnedAt ?? it.doneAt;
}

export function Row(props: {
  item: () => ItemView;
  expanded: () => boolean;
  app: DocApp;
  selection: DndSelection;
  viewKind: ViewKey["kind"];
  duplicateBlock: (sourceIds: readonly string[]) => void;
  copyBlock: (sourceIds: readonly string[]) => void;
  /** Called by a draft row from its collapse effect with the trimmed
   *  edit text and the notes textarea contents. Empty text means drop
   *  the draft; non-empty means the workspace should commit it as a
   *  real item. `chain` is true when the collapse was driven by Enter —
   *  the workspace re-opens a fresh draft so capture continues until
   *  Escape / blur / empty-Enter. */
  onDraftSettle?: (text: string, chain: boolean) => void;
  /** Open this item in the detail dialog. `focus` picks which field the
   *  dialog lands the caret in — the note badge opens straight to notes.
   *  `caret` is a title character offset (from a double-click) so the dialog
   *  lands the caret where the user pointed instead of at the end. */
  onOpen?: (id: string, focus?: "notes", caret?: number) => void;
  /** When true (mobile), a plain tap on the row opens the dialog instead
   *  of only selecting — inline editing is unpleasant on touch. */
  openOnTap?: () => boolean;
  /** Board cards show the item's created date in their bottom-left corner
   *  (list rows don't). */
  showCreated?: boolean;
  /** Done view only: when true, badge the row with its origin list name.
   *  Resolved via `listLabel` so `main` shows the Home label. */
  showList?: () => boolean;
  /** Resolves a list id to its display label (see Workspace `listLabel`). */
  listLabel?: (listId: string) => string;
  /** Open the shared calendar modal to set a due date on the target set.
   *  `initial` seeds the calendar (this row's current due date, or null). */
  onSetDue?: (ids: readonly string[], initial: string | null) => void;
}) {
  const { m, locale } = useAppI18n();
  // Origin-list badge text for the Done view (null when the badge is off,
  // the view isn't Done, or no label resolves).
  const originList = createMemo(() =>
    props.viewKind === "done" && props.showList?.()
      ? (props.listLabel?.(props.item().listId) || null)
      : null,
  );
  // Open state of this row's context menu, mirrored into the shared
  // overlay count so global keyboard shortcuts stand down while it's up.
  const [menuOpen, setMenuOpen] = createSignal(false);
  trackOverlay(menuOpen);
  let textRef!: HTMLSpanElement;
  // Set by the Enter keydown handler before it dispatches the synthetic
  // Escape that drives collapse. The collapse effect reads (and resets)
  // it so the workspace can tell Enter-commit from Escape/blur and chain
  // a fresh draft only on Enter.
  let chainOnSettle = false;

  // Order matters: this effect must run *before* the model-mirror effect
  // below. On collapse, both fire in the same tick — if the mirror runs
  // first, it overwrites the user's edit with the stale model text and
  // we save nothing.
  createEffect(
    on(
      props.expanded,
      (now, prev) => {
        if (!prev && now) {
          // Inline expansion is now only reached via Cmd+Enter / a new draft
          // (double-click opens the dialog instead), so the caret always
          // lands at the end of the text — typing appends rather than
          // overwriting a select-all.
          // Swap plain text for linkified anchors so URLs become clickable
          // while the row is editable. The collapse path & mirror effect
          // restore plain text, so anchors only exist in expanded rows.
          setLinkifiedText(textRef, props.item().text);
          queueMicrotask(() => {
            textRef.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(textRef);
            range.collapse(false);
            sel?.removeAllRanges();
            sel?.addRange(range);
          });
          return;
        }
        if (prev && !now) {
          const chain = chainOnSettle;
          chainOnSettle = false;
          const next = (textRef.textContent ?? "").trim();
          // Draft path: the row is a transient pseudo-item that has no
          // engine-side record yet. Hand the trimmed text back to the
          // workspace, which decides commit (addItemAt) vs drop. Skip the
          // editItemText path — there's no item to edit.
          if (isDraftId(props.item().id)) {
            props.onDraftSettle?.(next, chain);
            // When chaining, the workspace will open a fresh draft and
            // its expand effect will steal focus to the new row's
            // contentEditable; bouncing focus to the listbox here would
            // race that. Skip the listbox refocus on the chain path.
            if (!chain) {
              const listbox = textRef.closest<HTMLElement>('[role="listbox"]');
              listbox?.focus();
            }
            return;
          }
          const current = props.item().text;
          if (!next) {
            textRef.textContent = current;
          } else if (next !== current) {
            props.app.editItemText(props.item().id, next);
          }
          // Focus is still on the now-non-editable span; bounce it back
          // to the dnd listbox so arrow-key nav works without a click.
          const listbox = textRef.closest<HTMLElement>('[role="listbox"]');
          listbox?.focus();
        }
      },
      { defer: true },
    ),
  );

  // Absolute character offset in the row's (plain, pre-linkify) text under
  // the pointer — handed to the dialog so a double-click lands its title
  // caret exactly where the user pointed. The collapsed row holds a single
  // text node, so a hit-tested node offset is already the char position; a
  // hit outside the text (row padding) snaps to the end.
  const dblClickCharOffset = (e: MouseEvent): number => {
    type CPFP = (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    const cpfp = (
      document as unknown as { caretPositionFromPoint?: CPFP }
    ).caretPositionFromPoint;
    let node: Node | null = null;
    let offset = 0;
    if (cpfp) {
      const pos = cpfp.call(document, e.clientX, e.clientY);
      if (pos) {
        node = pos.offsetNode;
        offset = pos.offset;
      }
    }
    if (!node) {
      const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    }
    const len = textRef.textContent?.length ?? 0;
    if (node && node !== textRef && textRef.contains(node)) {
      return Math.min(offset, len);
    }
    return len;
  };

  // Mirror the model into the DOM while not expanded. While expanded
  // we leave the DOM alone so live edits aren't clobbered by reactive
  // updates from peer text changes. Plain text only — the expand path
  // swaps in linkified anchors so URLs are only clickable while editing.
  createEffect(() => {
    if (!props.expanded()) textRef.textContent = props.item().text;
  });

  // If the right-clicked row is already in the multi-select, act on the
  // whole selection; otherwise act on this row alone. The onOpenChange
  // hook below makes sure that an unselected row becomes the sole
  // selection before the menu actually opens.
  const targetIds = (): string[] => {
    const id = props.item().id;
    return props.selection.isSelected(id)
      ? props.selection.getSelectedKeys().map(String)
      : [id];
  };
  const binTargets = (): string[] =>
    targetIds().filter((k) => {
      const it = props.app.getItem(k);
      return it !== undefined && !isBinned(it);
    });
  const onBin = () => {
    const ids = binTargets();
    if (ids.length === 0) return;
    props.app.setBinnedMany(ids, true);
  };
  const onMarkDone = () => {
    const ids = targetIds();
    if (ids.length === 0) return;
    props.app.setDoneMany(ids, true);
  };
  const onMarkNotDone = () => {
    const ids = targetIds();
    if (ids.length === 0) return;
    props.app.setDoneMany(ids, false);
  };
  // Restore from bin: clear binned only, preserving done state. A
  // done-then-binned item lands back in the Done view; a plain binned
  // item back in its list. The user can flip done off explicitly via
  // the row checkbox or "Mark as not done" if needed.
  const onRestore = () => {
    const ids = targetIds().filter((id) => {
      const it = props.app.getItem(id);
      return it !== undefined && isBinned(it);
    });
    if (ids.length === 0) return;
    props.app.setBinnedMany(ids, false);
  };
  const onDelete = () => {
    const ids = targetIds().filter((id) => {
      const it = props.app.getItem(id);
      return it !== undefined && isBinned(it);
    });
    if (ids.length === 0) return;
    props.app.deleteBinnedMany(ids);
  };
  const onDuplicate = () => {
    props.duplicateBlock(targetIds());
  };
  const onCopy = () => {
    props.copyBlock(targetIds());
  };
  // Due-date actions apply to the whole target set (the selection when the
  // row is part of it, else this row alone), matching the done/bin actions.
  const onDueTomorrow = () => {
    const stamp = addDaysToStamp(todayStamp(nowMs()), 1);
    for (const id of targetIds()) props.app.setItemDueOn(id, stamp);
  };
  const onDueRemove = () => {
    for (const id of targetIds()) props.app.setItemDueOn(id, null);
  };
  const onSetDate = () => {
    props.onSetDue?.(targetIds(), props.item().dueOn ?? null);
  };
  const onOpenChange = (open: boolean) => {
    // Register the menu in the shared overlay count so the workspace's
    // document-level shortcuts (Enter → open dialog, x → done, …) go inert
    // while it's open — otherwise pressing Enter to pick a menu item also
    // triggers the list's Enter handler behind it.
    setMenuOpen(open);
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
        data-done={isDone(props.item()) ? "" : undefined}
        data-binned={isBinned(props.item()) ? "" : undefined}
        data-expanded={props.expanded() ? "" : undefined}
        on:dblclick={(e) => {
          // Double-click opens the detail dialog with its title caret placed
          // where the user pointed. Listen at the row level (not the text
          // span) so double-clicks in the row's padding still resolve a
          // caret. Native (non-delegated) + stopPropagation so it runs in
          // the bubble phase and suppresses the dnd listbox's own dblclick
          // (which would otherwise start an inline expansion). Drafts and
          // any already-expanded row keep their inline editor.
          if (props.expanded() || isDraftId(props.item().id)) return;
          e.preventDefault();
          e.stopPropagation();
          const caret = dblClickCharOffset(e);
          props.onOpen?.(props.item().id, undefined, caret);
        }}
        on:click={(e) => {
          // Mobile: a plain tap opens the detail dialog. Selection still
          // happens via the dnd's own touch handling; we just add the
          // open. Skip drafts, expanded rows, and taps that land on their
          // own controls (checkbox, links, the open/note buttons).
          if (!props.openOnTap?.()) return;
          if (props.expanded() || isDraftId(props.item().id)) return;
          const t = e.target as HTMLElement | null;
          if (t?.closest("input, a, button")) return;
          props.onOpen?.(props.item().id);
        }}
      >
        <input
          type="checkbox"
          tabIndex={-1}
          checked={isDone(props.item())}
          onChange={(e) =>
            props.app.setDone(props.item().id, e.currentTarget.checked)
          }
        />
        <div class="row-body">
          <span
            ref={textRef}
            class="row-text"
            contentEditable={props.expanded()}
            onClick={(e) => {
              if (!props.expanded()) return;
              // Anchors inside contenteditable don't navigate by default —
              // clicks place the caret. Intercept plain (no-modifier) clicks
              // on links so they open in a new tab; modifier-clicks fall
              // through to native behavior so the user can still place the
              // caret inside a link to edit it.
              const link = (e.target as HTMLElement | null)?.closest("a");
              if (
                link instanceof HTMLAnchorElement &&
                textRef.contains(link) &&
                !e.metaKey &&
                !e.ctrlKey &&
                !e.shiftKey &&
                !e.altKey
              ) {
                e.preventDefault();
                e.stopPropagation();
                window.open(link.href, "_blank", "noopener,noreferrer");
                return;
              }
              e.stopPropagation();
            }}
            onPointerDown={(e) => {
              if (props.expanded()) e.stopPropagation();
            }}
            on:paste={(e) => {
              if (!props.expanded()) return;
              // Strip formatting: paste plain text only, so rich HTML
              // never enters the editor (it'd render styled until the
              // row collapses and we save `textContent`).
              pasteAsPlainText(e);
            }}
            on:input={() => {
              // Browsers (Chrome, Firefox) leave a stray <br> behind when
              // the user deletes the last character of a contenteditable,
              // which defeats the `:empty::before` placeholder. Strip it
              // when the visible text is empty so the placeholder returns.
              if (textRef.textContent === "" && textRef.firstChild) {
                textRef.replaceChildren();
              }
            }}
            on:blur={(e) => {
              // iOS Safari's form-assistant bar (the prev/next/Done strip
              // above the keyboard) blurs the contenteditable on Done
              // without firing a keydown — the row would otherwise stay
              // expanded with the keyboard gone. Treat focus leaving the
              // row entirely as a commit, mirroring the Enter path. Skip
              // when focus is moving to another element inside the same
              // row (e.g. tapping into the notes textarea) so the user can
              // still hop fields without collapsing.
              if (!props.expanded()) return;
              const next = e.relatedTarget as Node | null;
              const row = (e.currentTarget as HTMLElement).closest(".row");
              if (next && row?.contains(next)) return;
              // First Escape: dnd is expanded → collapse. Second Escape:
              // dnd is now collapsed → clears selection. Without the
              // second one the row's pre-expand selection chrome flashes
              // visible on desktop until the next click selects another
              // row on mouseup; the dnd bails on mousedown while expanded
              // so selection only updates on the click. The Enter path
              // doesn't hit this because there's no follow-up click.
              const target = e.currentTarget as HTMLElement;
              target.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
              );
              target.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
              );
            }}
            on:keydown={(e) => {
              // Native (non-delegated) so the bubble order is span → dnd
              // listbox; Solid's delegated `onKeyDown` fires at document
              // level *after* the listbox sees the event, so a delegated
              // stopPropagation here would be too late (Cmd+A would still
              // hit the dnd's select-all).
              if (!props.expanded()) return;
              if (e.key === "Enter" && !e.shiftKey) {
                // Suppress the newline; bounce off the dnd's Escape
                // handler (bound on its listbox) to drive collapse, which
                // triggers the save effect above. Stop propagation so the
                // workspace's document-level Enter handler doesn't see the
                // original event after the synchronous Escape dispatch has
                // already flipped contentEditable off on this span — the
                // editable-surface guard there would no longer match and
                // it would re-expand the row.
                e.preventDefault();
                e.stopPropagation();
                // Mark this as the Enter-commit path so the collapse
                // effect tells the workspace to chain another draft.
                // Escape and blur reach the same collapse without setting
                // this flag, so they end the chain.
                chainOnSettle = true;
                (e.currentTarget as HTMLElement).dispatchEvent(
                  new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
                );
                return;
              }
              // Don't let the dnd intercept keys the contenteditable owns.
              if (e.key !== "Escape") e.stopPropagation();
            }}
          />
          <Show when={props.showCreated && !props.expanded()}>
            <div class="row-footer">
              <span
                class="row-created"
                title={new Date(props.item().createdAt).toLocaleString(locale())}
              >
                {formatRelative(props.item().createdAt, nowMs(), locale())}
              </span>
              <Show when={props.item().dueOn}>
                {(due) => (
                  <DueBadge
                    dueOn={due()}
                    muted={isDone(props.item()) || isBinned(props.item())}
                  />
                )}
              </Show>
            </div>
          </Show>
        </div>
        <Show when={!props.showCreated && !props.expanded() && props.item().dueOn}>
          {(due) => (
            <DueBadge
              dueOn={due()}
              muted={isDone(props.item()) || isBinned(props.item())}
            />
          )}
        </Show>
        <Show when={originList()}>
          {(name) => (
            <span class="row-list" title={name()}>
              {name()}
            </span>
          )}
        </Show>
        <Show when={lifecycleTimestamp(props.item())}>
          {(ts) => (
            <span class="row-timestamp" title={new Date(ts()).toLocaleString(locale())}>
              {props.viewKind === "done"
                ? formatDoneStamp(ts(), nowMs(), locale())
                : formatRelative(ts(), nowMs(), locale())}
            </span>
          )}
        </Show>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content class="context-menu-content">
          <Show when={isOpen(props.item())}>
            <ContextMenu.Item
              class="context-menu-item"
              onSelect={() => props.onOpen?.(props.item().id)}
            >
              <span>{m().common.open}</span>
              <kbd class="menu-shortcut">↵</kbd>
            </ContextMenu.Item>
          </Show>
          <Show when={!isDone(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onMarkDone}>
              <span>{m().workspace.markDone}</span>
              <kbd class="menu-shortcut">X</kbd>
            </ContextMenu.Item>
          </Show>
          <Show when={isDone(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onMarkNotDone}>
              <span>{m().workspace.markNotDone}</span>
              <kbd class="menu-shortcut">X</kbd>
            </ContextMenu.Item>
          </Show>
          <Show when={!isBinned(props.item())}>
            <ContextMenu.Sub gutter={4}>
              <ContextMenu.SubTrigger class="context-menu-item">
                <span>{m().due.label}</span>
                <span class="menu-sub-arrow" aria-hidden="true">
                  ›
                </span>
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent class="context-menu-content">
                  <Show when={props.item().dueOn}>
                    <ContextMenu.Item
                      class="context-menu-item"
                      onSelect={onDueRemove}
                    >
                      <span>{m().due.remove}</span>
                    </ContextMenu.Item>
                  </Show>
                  <Show when={props.onSetDue}>
                    <ContextMenu.Item
                      class="context-menu-item"
                      onSelect={onSetDate}
                    >
                      <span>{m().due.setDate}</span>
                    </ContextMenu.Item>
                  </Show>
                  <ContextMenu.Item
                    class="context-menu-item"
                    onSelect={onDueTomorrow}
                  >
                    <span>{m().due.tomorrow}</span>
                  </ContextMenu.Item>
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          </Show>
          <ContextMenu.Item class="context-menu-item" onSelect={onCopy}>
            <span>{m().common.copy}</span>
            <kbd class="menu-shortcut">⌘C</kbd>
          </ContextMenu.Item>
          <Show when={isOpen(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onDuplicate}>
              <span>{m().workspace.duplicate}</span>
              <kbd class="menu-shortcut">⌘D</kbd>
            </ContextMenu.Item>
          </Show>
          <Show when={!isBinned(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onBin}>
              <span>{m().workspace.moveToBin}</span>
              <kbd class="menu-shortcut">⌫</kbd>
            </ContextMenu.Item>
          </Show>
          <Show when={isBinned(props.item())}>
            <ContextMenu.Item class="context-menu-item" onSelect={onRestore}>
              {m().common.restore}
            </ContextMenu.Item>
            <ContextMenu.Item class="context-menu-item" onSelect={onDelete}>
              <span>{m().common.delete}</span>
              <kbd class="menu-shortcut">⌫</kbd>
            </ContextMenu.Item>
          </Show>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
