// The Upcoming view: the main-surface home for deadlines and the seed of
// a calendar surface. Every Open item with a deadline, bucketed by day
// (`deadlineGroups.ts`), Today always anchored so the surface reads as
// "the days ahead" even when nothing is due. Overdue items live in Today
// rather than a section of their own — a slipped deadline is still owed
// now — and are the only rows that badge a date, in the overdue tone, since
// the day header already carries everyone else's. Rows tick off in place
// and open the task surface (dialog or side panel) on click.
//
// Deliberately not a `Dnd` listbox: day sections are the point, and the
// flat virtualised list can't host group headers. Selection, keyboard
// nav and drag-to-reschedule are the calendar's future, not this seed.

import { createMemo, For, Show } from "solid-js";
import { DeadlineBadge } from "./DeadlineBadge.tsx";
import { groupByDeadline, type DeadlineGroup } from "./deadlineGroups.ts";
import { nowMs, todayStamp } from "./format.tsx";
import { useAppI18n } from "./i18n.tsx";
import { isDone, type DocApp } from "./sync/store.ts";

export function Upcoming(props: {
  app: DocApp;
  /** Display label for a list id (Inbox is localized, others by name). */
  listLabel: (listId: string) => string;
  onOpen: (id: string) => void;
}) {
  const { m, locale } = useAppI18n();

  const groups = createMemo<DeadlineGroup[]>(() =>
    groupByDeadline(
      Object.values(props.app.state.itemsById),
      todayStamp(nowMs()),
      {
        overdue: m().deadline.overdue,
        today: m().deadline.today,
        tomorrow: m().deadline.tomorrow,
      },
      locale(),
    ),
  );

  // Every day heads with the same long-form date ("Sat 24 Sept"); Today
  // is the only one annotated, so the eye lands on it without the other
  // days changing shape as they approach.
  const dayHeading = (g: DeadlineGroup): string => {
    const [y, mo, d] = g.key.split("-").map(Number);
    if (!y || !mo || !d) return g.label;
    const date = new Intl.DateTimeFormat(locale(), {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(y, mo - 1, d));
    return g.urgency === "today" ? `${date} (${m().deadline.today})` : date;
  };

  return (
    <div class="upcoming" tabIndex={-1}>
      <For each={groups()}>
        {(g) => (
          <section class="upcoming-day" data-urgency={g.urgency}>
            <header class="upcoming-day-header">
              <h2 class="upcoming-day-label">{dayHeading(g)}</h2>
            </header>
            <Show
              when={g.items.length > 0}
              fallback={
                <div class="upcoming-empty-day">
                  {m().upcoming.emptyToday}
                </div>
              }
            >
              <For each={g.items}>
                {(it) => (
                  <div
                    class="upcoming-row"
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      const t = e.target as HTMLElement | null;
                      if (t?.closest("input")) return;
                      props.onOpen(it.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      class="task-check"
                      checked={isDone(it)}
                      aria-label={m().workspace.markDone}
                      onChange={(e) =>
                        props.app.setDone(it.id, e.currentTarget.checked)
                      }
                    />
                    <span class="upcoming-row-text">{it.text}</span>
                    <span class="upcoming-row-meta">
                      <Show when={it.deadline! < g.key}>
                        <DeadlineBadge deadline={it.deadline!} pastAsDate />
                      </Show>
                      <span
                        class="badge row-list"
                        title={props.listLabel(it.listId)}
                      >
                        <span class="row-list-name">
                          {props.listLabel(it.listId)}
                        </span>
                      </span>
                    </span>
                  </div>
                )}
              </For>
            </Show>
          </section>
        )}
      </For>
    </div>
  );
}
