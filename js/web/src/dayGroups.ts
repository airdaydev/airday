// Day grouping behind the Upcoming view (`spec/calendar-plan.md`
// "Agenda"): every Open item carrying a `when` or a `deadline`, placed
// once on the earlier of the two days, each clamped up to today. Today
// always leads and absorbs everything past: an overdue deadline is still
// owed now, a slipped `when` is still the user's call, and a separate
// pile for either is the section people learn to skip. Done / binned
// items never appear. Pure so it can be unit-tested without a DOM
// (`test/dayGroups.test.ts`).

import { formatDeadlineBadge, whenDay } from "./format.tsx";
import { isOpen, type ItemView } from "./sync/store.ts";

/** Most urgent first when comparing. */
export type DayTone = "overdue" | "warning" | "slipped" | "neutral";

export interface DayRow {
  item: ItemView;
  /** Which field put the row on this day. */
  placedBy: "when" | "deadline";
  tone: DayTone;
}

export interface DayGroup {
  /** Group key: the `YYYY-MM-DD` stamp of the day. Past dates share the
   *  Today key, so a row's own date may sort before it. */
  key: string;
  label: string;
  urgency: "today" | "future";
  rows: DayRow[];
}

export interface DayGroupLabels {
  overdue: string;
  today: string;
  tomorrow: string;
}

const FOLD_OVERDUE = 0;
const FOLD_SLIPPED = 1;
const FOLD_OWN = 2;

/** Bucket `items` by placement day. `today` is the local `YYYY-MM-DD`
 *  stamp everything is judged against. Today is always the first group,
 *  empty if nothing is due, so the surface anchors on the current day.
 *
 *  Within a day: overdue deadlines lead (oldest first), then slipped whens
 *  (oldest first), then the day's own rows by the raw string of the
 *  placing field (all-day ahead of timed), then `createdAt`. */
export function groupByDay(
  items: Iterable<ItemView>,
  today: string,
  labels: DayGroupLabels,
  locale: string,
): DayGroup[] {
  const placed: { day: string; fold: number; raw: string; row: DayRow }[] = [];
  for (const it of items) {
    if (!isOpen(it) || (!it.when && !it.deadline)) continue;
    const wDay = it.when ? whenDay(it.when) : null;
    const dDay = it.deadline ?? null;
    const clamp = (d: string) => (d < today ? today : d);
    const wPlaced = wDay ? clamp(wDay) : null;
    const dPlaced = dDay ? clamp(dDay) : null;
    // `when` wins a tie: it is the "happens on" date and renders first.
    let day: string;
    let placedBy: DayRow["placedBy"];
    let raw: string;
    if (wPlaced && (!dPlaced || wPlaced <= dPlaced)) {
      day = wPlaced;
      placedBy = "when";
      raw = it.when!;
    } else {
      day = dPlaced!;
      placedBy = "deadline";
      raw = dDay!;
    }
    const overdue = dDay !== null && dDay < today;
    const slipped = wDay !== null && wDay < today;
    const tone: DayTone = overdue
      ? "overdue"
      : dDay === today
        ? "warning"
        : slipped
          ? "slipped"
          : "neutral";
    let fold = FOLD_OWN;
    if (overdue) {
      fold = FOLD_OVERDUE;
      raw = dDay!;
    } else if (slipped) {
      fold = FOLD_SLIPPED;
      raw = it.when!;
    }
    placed.push({ day, fold, raw, row: { item: it, placedBy, tone } });
  }
  placed.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.fold - b.fold ||
      a.raw.localeCompare(b.raw) ||
      a.row.item.createdAt - b.row.item.createdAt,
  );

  const out: DayGroup[] = [
    { key: today, label: labels.today, urgency: "today", rows: [] },
  ];
  for (const p of placed) {
    const last = out[out.length - 1]!;
    if (last.key === p.day) {
      last.rows.push(p.row);
      continue;
    }
    // Day labels reuse the deadline badge's Tomorrow / weekday / compact
    // date rules, judged against today.
    const info = formatDeadlineBadge(p.day, today, labels, locale);
    out.push({
      key: p.day,
      label: info?.label ?? p.day,
      urgency: "future",
      rows: [p.row],
    });
  }
  return out;
}
