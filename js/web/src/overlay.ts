// Central coordination between overlays (modals, dialogs, the find
// palette) and the workspace's global keyboard shortcuts.
//
// The shortcuts in Workspace.tsx / FindPalette.tsx listen on `document`,
// so a keystroke aimed at an open modal (pressing a non-editable button
// inside it, or just having the dialog focused) still bubbles through to
// the list behind it — pressing `x` toggled done, Space started a draft,
// Delete binned rows, etc. Kobalte's Dialog traps focus and swallows
// Escape, but plain keydown still reaches document.
//
// Rather than teach every shortcut about every modal, overlays opt in to
// a shared open-count and shortcuts consult it. The count (not a boolean)
// so stacked overlays — a ConfirmDialog over Settings — settle correctly.

import { createEffect, createSignal, onCleanup } from "solid-js";

const [overlayCount, setOverlayCount] = createSignal(0);

/** True while any tracked overlay is open. */
export const isOverlayOpen = () => overlayCount() > 0;

/** Mark an overlay as open while `open()` is true. Increments the shared
 *  count on open, decrements on close or unmount. Call from the overlay
 *  component's body: `trackOverlay(() => props.open)`. */
export function trackOverlay(open: () => boolean): void {
  createEffect(() => {
    if (!open()) return;
    setOverlayCount((c) => c + 1);
    onCleanup(() => setOverlayCount((c) => c - 1));
  });
}

/** Register a document-level keyboard shortcut that is inert whenever an
 *  overlay is open or focus sits in an editable surface (input, textarea,
 *  contenteditable). Centralises the two guards every workspace shortcut
 *  used to repeat, and auto-cleans on unmount — so it must be called from
 *  a component/reactive scope where `onCleanup` is bound. */
export function onGlobalKey(handler: (e: KeyboardEvent) => void): void {
  const listener = (e: KeyboardEvent) => {
    if (isOverlayOpen()) return;
    const target = e.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    handler(e);
  };
  document.addEventListener("keydown", listener);
  onCleanup(() => document.removeEventListener("keydown", listener));
}
