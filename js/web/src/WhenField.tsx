// The task dialog's planned-date control, the `when` twin of
// `DeadlineField`: an always-visible badge (calendar icon + "When" when
// unset) that opens a small popover with quick actions — Set date…
// (calendar modal with the optional time field), Today, Tomorrow, and
// Remove date when one is set. Today / Tomorrow keep any time part.

import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Show } from "solid-js";
import { DeadlineCalendarDialog } from "./DeadlineCalendarDialog.tsx";
import { addDaysToStamp, nowMs, todayStamp, whenFromParts, whenTime } from "./format.tsx";
import calendarSvg from "./icons/calendar.svg?raw";
import { useAppI18n } from "./i18n.tsx";
import { WhenBadge } from "./WhenBadge.tsx";

export function WhenField(props: {
  when: () => string | null;
  muted: () => boolean;
  onChange: (value: string | null) => void;
  open: () => boolean;
  setOpen: (v: boolean) => void;
}) {
  const { m } = useAppI18n();
  const keepTime = (day: string) => whenFromParts(day, whenTime(props.when() ?? ""));

  return (
    <>
      <DropdownMenu gutter={4}>
        <DropdownMenu.Trigger
          class="task-dialog-deadline-trigger"
          aria-label={m().when.label}
        >
          <Show
            when={props.when()}
            fallback={
              <span class="badge when-badge" data-tone="muted">
                <span class="deadline-badge-icon" innerHTML={calendarSvg} />
                {m().when.unset}
              </span>
            }
          >
            {(w) => <WhenBadge when={w()} muted={props.muted()} />}
          </Show>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="dropdown-menu-content task-dialog-menu-content">
            <Show when={props.when()}>
              <DropdownMenu.Item
                class="dropdown-menu-item"
                onSelect={() => props.onChange(null)}
              >
                <span>{m().when.remove}</span>
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
              <span>{m().when.setDate}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="dropdown-menu-item"
              onSelect={() => props.onChange(keepTime(todayStamp(nowMs())))}
            >
              <span>{m().when.today}</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="dropdown-menu-item"
              onSelect={() =>
                props.onChange(keepTime(addDaysToStamp(todayStamp(nowMs()), 1)))
              }
            >
              <span>{m().when.tomorrow}</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      <DeadlineCalendarDialog
        kind="when"
        open={props.open}
        setOpen={props.setOpen}
        value={props.when}
        onPick={props.onChange}
        onRemove={() => props.onChange(null)}
      />
    </>
  );
}
