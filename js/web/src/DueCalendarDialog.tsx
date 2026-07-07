// Centered modal wrapping corvu's headless `@corvu/calendar`, used to pick a
// due date. Fully controlled + triggerless so it can be driven from anywhere
// (the task dialog's badge/menu, a list/board row's context menu). A Kobalte
// Dialog rather than a Popover: opened from a closing menu, a popover fights
// the menu's focus-restore and instantly dismisses; a modal doesn't.

import Calendar from "@corvu/calendar";
import { Dialog } from "@kobalte/core/dialog";
import { createMemo, For } from "solid-js";
import { localDateStamp, parseLocalDateParts } from "./format.tsx";
import { useAppI18n } from "./i18n.tsx";

export function DueCalendarDialog(props: {
  open: () => boolean;
  setOpen: (v: boolean) => void;
  /** Currently-set stamp to preselect / open the calendar on, or null. */
  value: () => string | null;
  /** Fired with the picked `YYYY-MM-DD` (never null — clearing lives in the
   *  menus); the dialog closes itself after. */
  onPick: (stamp: string) => void;
}) {
  const { m, locale } = useAppI18n();

  // Register stamp ⇄ Date on the boundary — the register stores a floating
  // local `YYYY-MM-DD`; corvu works in `Date`s. Never `new Date(stamp)`
  // (that's UTC and shifts the day in negative-offset zones).
  const value = createMemo<Date | null>(() => {
    const s = props.value();
    return s ? parseLocalDateParts(s) : null;
  });

  const monthLabelFmt = createMemo(
    () => new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }),
  );
  const weekdayFmt = createMemo(
    () => new Intl.DateTimeFormat(locale(), { weekday: "short" }),
  );

  return (
    <Dialog open={props.open()} onOpenChange={props.setOpen} modal>
      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay due-dialog-overlay" />
        <div class="dialog-positioner due-dialog-positioner">
          <Dialog.Content class="due-dialog">
            <Calendar
              mode="single"
              value={value()}
              initialMonth={value() ?? undefined}
              onValueChange={(d) => {
                if (d) props.onPick(localDateStamp(d));
                props.setOpen(false);
              }}
            >
              {(cal) => (
                <>
                  <div class="calendar-header">
                    <Calendar.Nav
                      action="prev-month"
                      class="calendar-nav"
                      aria-label={m().due.prevMonth}
                    >
                      ‹
                    </Calendar.Nav>
                    <Calendar.Label class="calendar-label">
                      {monthLabelFmt().format(cal.month)}
                    </Calendar.Label>
                    <Calendar.Nav
                      action="next-month"
                      class="calendar-nav"
                      aria-label={m().due.nextMonth}
                    >
                      ›
                    </Calendar.Nav>
                  </div>
                  <Calendar.Table class="calendar-table">
                    <thead>
                      <tr>
                        <For each={cal.weekdays}>
                          {(weekday) => (
                            <Calendar.HeadCell class="calendar-headcell">
                              {weekdayFmt().format(weekday)}
                            </Calendar.HeadCell>
                          )}
                        </For>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={cal.weeks}>
                        {(week) => (
                          <tr>
                            <For each={week}>
                              {(day) => (
                                <Calendar.Cell class="calendar-cell">
                                  <Calendar.CellTrigger
                                    day={day}
                                    class="calendar-cell-trigger"
                                  >
                                    {day.getDate()}
                                  </Calendar.CellTrigger>
                                </Calendar.Cell>
                              )}
                            </For>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </Calendar.Table>
                </>
              )}
            </Calendar>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
