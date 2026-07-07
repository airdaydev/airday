// The task dialog's due-date control: a read-only badge (or a faint "add"
// affordance when unset) that opens the shared centered calendar modal.
// Opening is exposed via `registerOpen` so the header ⋮ menu's "Set date"
// item can drive it, matching the EditableNavLabel `registerStart` pattern.

import { onMount, Show } from "solid-js";
import { DueBadge } from "./DueBadge.tsx";
import { DueCalendarDialog } from "./DueCalendarDialog.tsx";
import { useAppI18n } from "./i18n.tsx";

export function DueField(props: {
  dueOn: () => string | null;
  muted: () => boolean;
  onChange: (stamp: string | null) => void;
  /** Called once on mount with a function that opens the calendar (invoked
   *  by the header menu's "Set date" item). */
  registerOpen?: (fn: () => void) => void;
  open: () => boolean;
  setOpen: (v: boolean) => void;
}) {
  const { m } = useAppI18n();

  // Register-based binding so the menu item can open us without threading a
  // signal through every layer between here and the header.
  onMount(() => props.registerOpen?.(() => props.setOpen(true)));

  return (
    <>
      {/* No affordance when unset — the badge only appears once a due date
          exists; setting one from scratch goes through the ⋮ menu. */}
      <Show when={props.dueOn()}>
        <button
          type="button"
          class="task-dialog-due-trigger"
          aria-label={m().due.label}
          onClick={() => props.setOpen(true)}
        >
          <DueBadge dueOn={props.dueOn()!} muted={props.muted()} />
        </button>
      </Show>
      <DueCalendarDialog
        open={props.open}
        setOpen={props.setOpen}
        value={props.dueOn}
        onPick={props.onChange}
      />
    </>
  );
}
