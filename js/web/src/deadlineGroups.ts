// Day grouping behind the Upcoming view: every Open item carrying a deadline, soonest first, bucketed by
// calendar day. Today always leads and absorbs everything overdue: a slipped
// deadline is still "owed now", and a separate Overdue pile is the section
// people learn to skip. Done / binned items never appear — nothing is still
// due on them. Pure so it can be unit-tested without a DOM
// (`test/deadlineGroups.test.ts`).

import { formatDeadlineBadge } from "./format.tsx";
import { isOpen, type ItemView } from "./sync/store.ts";

export interface DeadlineGroup {
  /** Group key: the `YYYY-MM-DD` stamp of the day. Overdue items share
   *  the Today key, so an item's own `deadline` may sort before it. */
  key: string;
  label: string;
  urgency: "today" | "future";
  items: ItemView[];
}

export interface DeadlineGroupLabels {
  overdue: string;
  today: string;
  tomorrow: string;
}

/** Bucket `items` by deadline day. `today` is the local `YYYY-MM-DD`
 *  stamp the urgency is judged against. Today is always the first group,
 *  empty if nothing is due, so the surface anchors on the current day;
 *  overdue items fold into it ahead of today's own, oldest first. */
export function groupByDeadline(
  items: Iterable<ItemView>,
  today: string,
  labels: DeadlineGroupLabels,
  locale: string,
): DeadlineGroup[] {
  const dated = [...items]
    .filter((it) => isOpen(it) && it.deadline)
    .sort(
      (a, b) =>
        a.deadline!.localeCompare(b.deadline!) || a.createdAt - b.createdAt,
    );
  const out: DeadlineGroup[] = [
    { key: today, label: labels.today, urgency: "today", items: [] },
  ];
  for (const it of dated) {
    const info = formatDeadlineBadge(it.deadline!, today, labels, locale);
    if (!info) continue;
    if (info.urgency !== "future") {
      out[0]!.items.push(it);
      continue;
    }
    const last = out[out.length - 1]!;
    if (last.key === it.deadline) {
      last.items.push(it);
    } else {
      out.push({
        key: it.deadline!,
        label: info.label,
        urgency: "future",
        items: [it],
      });
    }
  }
  return out;
}
