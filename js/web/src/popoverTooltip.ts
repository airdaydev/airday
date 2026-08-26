import { createSignal } from "solid-js";

/**
 * Guard for a trigger that carries both a Kobalte `Tooltip` and a
 * `Popover`. Keeps the tooltip quiet while the popover is open, and across
 * the focus-restore on close: Kobalte returns focus to the trigger in a
 * `setTimeout(0)` after the popover's `open` has already flipped to false,
 * and the tooltip trigger opens on any `focus` (it doesn't check
 * `:focus-visible`), so without the bridge the tooltip pops up on the button
 * after dismissing with a click elsewhere. `Popover.Content`'s
 * `onCloseAutoFocus` fires synchronously just before that restore, so a
 * one-microtask hold covers it.
 *
 * Spread the returned bags onto the matching components:
 *
 *   <Popover {...guard.popover}>
 *     <Tooltip {...guard.tooltip}>…</Tooltip>
 *     <Popover.Portal>
 *       <Popover.Content {...guard.content}>…</Popover.Content>
 */
export function createPopoverTooltipGuard() {
  const [open, setOpen] = createSignal(false);
  const [restoringFocus, setRestoringFocus] = createSignal(false);
  return {
    open,
    popover: {
      get open() {
        return open();
      },
      onOpenChange: setOpen,
    },
    tooltip: {
      get disabled() {
        return open() || restoringFocus();
      },
    },
    content: {
      onCloseAutoFocus: () => {
        setRestoringFocus(true);
        queueMicrotask(() => setRestoringFocus(false));
      },
    },
  };
}
