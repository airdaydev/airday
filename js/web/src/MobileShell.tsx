// Mobile chrome: two floating glass pills along the bottom edge.
//
// On phones the desktop sidebar + footer are not rendered at all (see
// Workspace.tsx). The left pill carries Find (which doubles as the list
// switcher: the palette lists every view on an empty query) and
// Settings; the right pill is Add. The sync indicator moves into the
// main header's action slot. No custom drawer: the DOM can't fake a
// native sheet convincingly, so we don't try.

import { Show } from "solid-js";
import { useAppI18n } from "./i18n.tsx";
import caretUpDownSvg from "./icons/caret-up-down.svg?raw";
import mixerHzSvg from "./icons/mixer-hz.svg?raw";
import plusSvg from "./icons/plus.svg?raw";

export function MobileBars(props: {
  onFind: () => void;
  onOpenSettings: () => void;
  /** null hides the add pill (views that can't capture). */
  onAdd: (() => void) | null;
  addDisabled: boolean;
}) {
  const { m } = useAppI18n();
  return (
    <>
      <nav class="mobile-bar mobile-bar-left glass" aria-label={m().common.menu}>
        <button
          type="button"
          class="mobile-bar-btn"
          aria-label={m().find.placeholder}
          onClick={props.onFind}
          innerHTML={caretUpDownSvg}
        />
        <button
          type="button"
          class="mobile-bar-btn"
          aria-label={m().nav.settings}
          onClick={props.onOpenSettings}
          innerHTML={mixerHzSvg}
        />
      </nav>
      <Show when={props.onAdd}>
        {(onAdd) => (
          <div class="mobile-bar mobile-bar-right glass">
            <button
              type="button"
              class="mobile-bar-btn"
              aria-label={m().common.add}
              disabled={props.addDisabled}
              onClick={(e) => {
                // Stop the dnd's document-level collapse handler from
                // immediately closing the new draft (same as the FAB did).
                e.stopImmediatePropagation();
                onAdd()();
              }}
              innerHTML={plusSvg}
            />
          </div>
        )}
      </Show>
    </>
  );
}
