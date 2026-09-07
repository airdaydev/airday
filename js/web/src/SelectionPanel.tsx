// The desktop side panel's multi-select surface: shown in place of the
// task pane while the active list / board lane selection spans more than
// one row. A heading with the count, then one button per bulk action.
// Workspace builds the action list (it owns the selection, the view and
// the batch mutations); this file is only the chrome.
//
// The buttons deliberately use native (non-delegated) listeners:
// mousedown is cancelled so a click never pulls keyboard focus off the
// listbox (the arrows keep working afterwards), and click stops
// propagating so the dnd's document-level click-outside handler doesn't
// clear the very selection the button is acting on.

import { For, Show } from "solid-js";
import { useAppI18n } from "./i18n.tsx";

export interface SelectionAction {
  label: string;
  /** Keyboard equivalent, shown as a `<kbd>` hint (matches the row
   *  context menu's glyphs). */
  shortcut?: string;
  destructive?: boolean;
  run: () => void;
}

export function SelectionPanel(props: {
  count: number;
  actions: readonly SelectionAction[];
  onClear: () => void;
}) {
  const { m } = useAppI18n();
  const keepListFocus = (e: MouseEvent) => e.preventDefault();
  return (
    <div class="selection-panel">
      <h2 class="selection-panel-title">
        {m().sidePanel.selectedCount(props.count)}
      </h2>
      <div
        class="selection-panel-actions"
        role="group"
        aria-label={m().sidePanel.selectionActions}
      >
        <For each={props.actions}>
          {(a) => (
            <button
              type="button"
              class="selection-panel-action"
              classList={{ destructive: a.destructive === true }}
              on:mousedown={keepListFocus}
              on:click={(e) => {
                e.stopPropagation();
                a.run();
              }}
            >
              <span>{a.label}</span>
              <Show when={a.shortcut}>
                {(s) => <kbd class="menu-shortcut">{s()}</kbd>}
              </Show>
            </button>
          )}
        </For>
      </div>
      <hr class="selection-panel-rule" />
      <button
        type="button"
        class="selection-panel-action selection-panel-clear"
        on:mousedown={keepListFocus}
        on:click={(e) => {
          e.stopPropagation();
          props.onClear();
        }}
      >
        <span>{m().sidePanel.clearSelection}</span>
        <kbd class="menu-shortcut">Esc</kbd>
      </button>
    </div>
  );
}
