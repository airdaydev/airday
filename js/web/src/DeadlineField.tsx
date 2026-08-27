// The task dialog's deadline control: an always-visible badge (clock icon +
// "Deadline" when unset) that opens a small popover with quick actions —
// Set date… (calendar modal), Tomorrow, and Remove date when one is set.

import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Show } from "solid-js";
import { DeadlineBadge } from "./DeadlineBadge.tsx";
import { DeadlineCalendarDialog } from "./DeadlineCalendarDialog.tsx";
import { addDaysToStamp, nowMs, todayStamp } from "./format.tsx";
import timerSvg from "./icons/timer.svg?raw";
import { useAppI18n } from "./i18n.tsx";

export function DeadlineField(props: {
  deadline: () => string | null;
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
          class="task-dialog-deadline-trigger"
          aria-label={m().deadline.label}
        >
          <Show
            when={props.deadline()}
            fallback={
              <span class="badge deadline-badge" data-tone="muted">
                <span class="deadline-badge-icon" innerHTML={timerSvg} />
                {m().deadline.unset}
              </span>
            }
          >
            {(d) => <DeadlineBadge deadline={d()} muted={props.muted()} />}
          </Show>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="dropdown-menu-content task-dialog-menu-content">
            <Show when={props.deadline()}>
              <DropdownMenu.Item
                class="dropdown-menu-item"
                onSelect={() => props.onChange(null)}
              >
                <span>{m().deadline.remove}</span>
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
              <span>{m().deadline.setDate}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="dropdown-menu-item"
              onSelect={() =>
                props.onChange(addDaysToStamp(todayStamp(nowMs()), 1))
              }
            >
              <span>{m().deadline.tomorrow}</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      <DeadlineCalendarDialog
        open={props.open}
        setOpen={props.setOpen}
        value={props.deadline}
        onPick={props.onChange}
        onRemove={() => props.onChange(null)}
      />
    </>
  );
}
