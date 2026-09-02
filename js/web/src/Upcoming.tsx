// The Upcoming view: the main-surface home for deadlines and the seed of
// a calendar surface. Every Open item with a deadline, bucketed by day
// (`deadlineGroups.ts`), Today always anchored so the surface reads as
// "the days ahead" even when nothing is due. Rows tick off in place and
// open the task surface (dialog or side panel) on click; the day header
// carries the date, so only overdue rows badge the date that slipped.
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
      { ensureToday: true },
    ),
  );

  // Long-form day heading beside the short label: "Tomorrow · Thu 3 Sep".
  const dayDetail = (g: DeadlineGroup): string | null => {
    if (g.key === "overdue") return null;
    const [y, mo, d] = g.key.split("-").map(Number);
    if (!y || !mo || !d) return null;
    return new Intl.DateTimeFormat(locale(), {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(y, mo - 1, d));
  };

  return (
    <div class="upcoming" tabIndex={-1}>
      <For each={groups()}>
        {(g) => (
          <section class="upcoming-day" data-urgency={g.urgency}>
            <header class="upcoming-day-header">
              <h2 class="upcoming-day-label">{g.label}</h2>
              <Show when={dayDetail(g)}>
                {(detail) => (
                  <span class="upcoming-day-detail">{detail()}</span>
                )}
              </Show>
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
                      <Show when={g.urgency === "overdue"}>
                        <DeadlineBadge deadline={it.deadline!} muted />
                      </Show>
                      <span class="upcoming-row-list">
                        {props.listLabel(it.listId)}
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
