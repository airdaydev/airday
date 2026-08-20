// The task dialog's due-date control: an always-visible badge (clock icon +
// "Deadline" when unset) that opens a small popover with quick actions —
// Set date… (calendar modal), Tomorrow, and Remove date when one is set.

import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Show } from "solid-js";
import { DueBadge } from "./DueBadge.tsx";
import { DueCalendarDialog } from "./DueCalendarDialog.tsx";
import { addDaysToStamp, nowMs, todayStamp } from "./format.tsx";
import timerSvg from "./icons/timer.svg?raw";
import { useAppI18n } from "./i18n.tsx";

export function DueField(props: {
  dueOn: () => string | null;
  muted: () => boolean;
  onChange: (stamp: string | null) => void;
  open: () => boolean;
  setOpen: (v: boolean) => void;
}) {
  const { m } = useAppI18n();

  return (
    <>
      <DropdownMenu gutter={4}>
        <DropdownMenu.Trigger
          class="task-dialog-due-trigger"
          aria-label={m().due.label}
        >
          <Show
            when={props.dueOn()}
            fallback={
              <span class="badge due-badge" data-tone="muted">
                <span class="due-badge-icon" innerHTML={timerSvg} />
                {m().due.unset}
              </span>
            }
          >
            {(d) => <DueBadge dueOn={d()} muted={props.muted()} />}
          </Show>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="dropdown-menu-content task-dialog-menu-content">
            <Show when={props.dueOn()}>
              <DropdownMenu.Item
                class="dropdown-menu-item"
                onSelect={() => props.onChange(null)}
              >
                <span>{m().due.remove}</span>
              </DropdownMenu.Item>
            </Show>
            <DropdownMenu.Item
              class="dropdown-menu-item"
              onSelect={() => {
                // The calendar is a modal dialog, so it won't self-dismiss
                // on the menu's focus-restore; rAF just defers the open past
                // the menu teardown.
                requestAnimationFrame(() => props.setOpen(true));
              }}
            >
              <span>{m().due.setDate}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="dropdown-menu-item"
              onSelect={() =>
                props.onChange(addDaysToStamp(todayStamp(nowMs()), 1))
              }
            >
              <span>{m().due.tomorrow}</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      <DueCalendarDialog
        open={props.open}
        setOpen={props.setOpen}
        value={props.dueOn}
        onPick={props.onChange}
        onRemove={() => props.onChange(null)}
      />
    </>
  );
}
