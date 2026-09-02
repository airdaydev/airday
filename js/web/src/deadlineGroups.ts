// Day grouping behind the Upcoming view: every Open item carrying a deadline, soonest first, bucketed by
// calendar day. Overdue items fold into a single leading group since
// they're all equally "owed now". Done / binned items never appear —
// nothing is still due on them. Pure so it can be unit-tested without a
// DOM (`test/deadlineGroups.test.ts`).

import { formatDeadlineBadge } from "./format.tsx";
import { isOpen, type ItemView } from "./sync/store.ts";

export interface DeadlineGroup {
  /** Group key: `"overdue"` for everything before today, else the raw
   *  `YYYY-MM-DD` stamp shared by the group's items. */
  key: string;
  label: string;
  urgency: "overdue" | "today" | "future";
  items: ItemView[];
}

export interface DeadlineGroupLabels {
  overdue: string;
  today: string;
  tomorrow: string;
}

/** Bucket `items` by deadline day. `today` is the local `YYYY-MM-DD`
 *  stamp the urgency is judged against. With `ensureToday`, an empty
 *  Today group is emitted (after Overdue) so a calendar-style surface
 *  always anchors on the current day. */
export function groupByDeadline(
  items: Iterable<ItemView>,
  today: string,
  labels: DeadlineGroupLabels,
  locale: string,
  opts?: { ensureToday?: boolean },
): DeadlineGroup[] {
  const dated = [...items]
    .filter((it) => isOpen(it) && it.deadline)
    .sort(
      (a, b) =>
        a.deadline!.localeCompare(b.deadline!) || a.createdAt - b.createdAt,
    );
  const out: DeadlineGroup[] = [];
  for (const it of dated) {
    const info = formatDeadlineBadge(it.deadline!, today, labels, locale);
    if (!info) continue;
    const key = info.urgency === "overdue" ? "overdue" : it.deadline!;
    const last = out[out.length - 1];
    if (last && last.key === key) {
      last.items.push(it);
    } else {
      out.push({ key, label: info.label, urgency: info.urgency, items: [it] });
    }
  }
  if (opts?.ensureToday && !out.some((g) => g.key === today)) {
    const at = out[0]?.key === "overdue" ? 1 : 0;
    out.splice(at, 0, {
      key: today,
      label: labels.today,
      urgency: "today",
      items: [],
    });
  }
  return out;
}
