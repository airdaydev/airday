import { createSignal } from "solid-js";

// Shared 60s tick for relative-time labels ("5m ago"). One signal, one
// interval — every Row that reads it stays fresh without spawning its
// own timer.
const [nowMs, setNowMs] = createSignal(Date.now());
setInterval(() => setNowMs(Date.now()), 60_000);
export { nowMs };

function calendarDayDiff(later: Date, earlier: Date): number {
  const a = new Date(later.getFullYear(), later.getMonth(), later.getDate()).getTime();
  const b = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

const relativeEs = {
  justNow: "ahora mismo",
  minutesAgo: (n: number) => `hace ${n} min`,
  hoursAgo: (n: number) => `hace ${n} h`,
  yesterdayAt: (time: string) => `Ayer ${time}`,
};

const relativeEn = {
  justNow: "just now",
  minutesAgo: (n: number) => `${n}m ago`,
  hoursAgo: (n: number) => `${n}h ago`,
  yesterdayAt: (time: string) => `Yesterday ${time}`,
};

export function formatRelative(ts: number, now: number, locale: string): string {
  const diffMs = now - ts;
  const m = locale.startsWith("es") ? relativeEs : relativeEn;
  const timeFmt = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const monthDayFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const monthDayYearFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (diffMs < 60_000) return m.justNow;
  if (diffMs < 3_600_000) return m.minutesAgo(Math.floor(diffMs / 60_000));
  if (diffMs < 86_400_000) return m.hoursAgo(Math.floor(diffMs / 3_600_000));
  const tsDate = new Date(ts);
  const nowDate = new Date(now);
  const days = calendarDayDiff(nowDate, tsDate);
  if (days === 1) return m.yesterdayAt(timeFmt.format(tsDate));
  if (days < 7) return `${weekdayFmt.format(tsDate)} ${timeFmt.format(tsDate)}`;
  if (tsDate.getFullYear() === nowDate.getFullYear()) return monthDayFmt.format(tsDate);
  return monthDayYearFmt.format(tsDate);
}

// ---------- date-only due dates ----------
//
// Due dates are floating local calendar dates stored as raw `YYYY-MM-DD`
// strings. Everything here works on local date *parts* — we never call
// `new Date("YYYY-MM-DD")`, which parses as UTC midnight and shifts the
// day backwards in negative-offset timezones.

// Local `YYYY-MM-DD` stamp for a Date, built from its local parts.
export function localDateStamp(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

// Today's local calendar date as `YYYY-MM-DD`. `now` defaults to the
// current instant; callers thread the shared `nowMs()` tick so the value
// rolls over at local midnight without a bespoke timer.
export function todayStamp(now: number = Date.now()): string {
  return localDateStamp(new Date(now));
}

// `stamp` shifted by `n` whole days, staying on local calendar parts.
// Used for the dialog's "Tomorrow" quick action (`addDaysToStamp(today, 1)`).
export function addDaysToStamp(stamp: string, n: number): string {
  const d = parseLocalDateParts(stamp);
  if (!d) return stamp;
  return localDateStamp(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

// Parse `YYYY-MM-DD` into a local-midnight Date via explicit parts.
// Returns null for anything that isn't a well-formed stamp.
function parseLocalDateParts(stamp: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Urgency drives the badge's color role; the component maps done/binned
// items to a muted variant regardless of this value.
export type DueUrgency = "overdue" | "today" | "future";

export interface DueBadgeInfo {
  label: string;
  urgency: DueUrgency;
}

// Compact label + urgency for a due date, relative to `today` (both raw
// `YYYY-MM-DD`). Rules: before today → "Overdue"; today → "Today";
// tomorrow → "Tomorrow"; within the next 7 days → short weekday; else a
// compact `Jul 12` (with the year when it differs from today's). Labels
// for the fixed cases come from i18n so callers stay locale-correct.
export function formatDueBadge(
  dueOn: string,
  today: string,
  labels: { overdue: string; today: string; tomorrow: string },
  locale: string,
): DueBadgeInfo | null {
  const due = parseLocalDateParts(dueOn);
  const ref = parseLocalDateParts(today);
  if (!due || !ref) return null;
  const days = calendarDayDiff(due, ref);
  if (days < 0) return { label: labels.overdue, urgency: "overdue" };
  if (days === 0) return { label: labels.today, urgency: "today" };
  if (days === 1) return { label: labels.tomorrow, urgency: "future" };
  if (days < 7) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(due);
    return { label: weekday, urgency: "future" };
  }
  const opts: Intl.DateTimeFormatOptions =
    due.getFullYear() === ref.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return { label: new Intl.DateTimeFormat(locale, opts).format(due), urgency: "future" };
}

// Done-view stamp: same calendar day as `now` → time of day; otherwise
// the date. Strips the "X minutes ago" / "Yesterday HH:MM" / "Mon HH:MM"
// noise the relative format produces, since once a Done row ages past
// today the exact moment it got ticked off isn't useful — the date is.
export function formatDoneStamp(ts: number, now: number, locale: string): string {
  const tsDate = new Date(ts);
  const nowDate = new Date(now);
  if (calendarDayDiff(nowDate, tsDate) === 0) {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(tsDate);
  }
  if (tsDate.getFullYear() === nowDate.getFullYear()) {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(tsDate);
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(tsDate);
}
