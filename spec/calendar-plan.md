# Calendar: plan

**Status: plan, not built. Decided 2026-09-09.** Adds a second date to
items, `when`, alongside the existing `deadline`, and grows the Upcoming
view into a basic day-granular calendar: an agenda plus a month grid. No
recurrence rules, no time zones, no export in the first cut, each with its
extension point reserved so it lands later without a migration.

Companion to `data-model.md` (fields, mutations), `board.md` (lens model),
`urls.md` (view tokens), `cli.md` (verbs). Amend those in place as each phase
lands; this file is the design record.

## Decisions in one screen

| Question | Decision |
|---|---|
| Why a second field? | `deadline` means "owed by": past it the item is overdue and red. A planned or scheduled day means "happens on" or "act on": past it the item is not owed, it slipped. Using `deadline` for the second meaning makes every past event scream overdue. The distinction is what happens after the date, so it needs its own field. |
| Replace `deadline`, or flag it? | **Neither. Add `when` beside it.** Both can coexist on one item ("do it Saturday, due Oct 31"), which a single date plus a kind flag can't express. Additive, so six months of real data needs no migration. Same names as Things, which is the model people already know. |
| Date and time: one register or two? | **One register, `when`, shape-discriminated.** `YYYY-MM-DD` is all-day, `YYYY-MM-DDTHH:MM` is timed. Same rule as iCalendar `VALUE=DATE` vs `DATE-TIME`. One register can't tear under concurrent edit (date moved on one device, time set on another), sorts by plain string compare, and clears with one delete. An explicit flag is redundant with the shape and a third thing to keep consistent. |
| Time zone? | **Floating only, now.** A `when` is a wall-clock intent, the devices travel together, and floating keeps sorting a string compare. The grammar reserves an RFC 9557 bracketed IANA suffix (`...T14:00[Europe/London]`) for fixed-instant values. Writers may later default to appending the device zone; untouched values stay floating, so nothing migrates. Note this is the task-manager default, not the calendar default: Apple and Google pin timed events to a zone. |
| Recurrence? | **Not in the first cut.** No `repeat` field, no hint of one in the doc. Repeat-on-done (clone with the date advanced when ticked Done) is the likely first form; RRULE-style schedules are a calendar app's job. |
| Does the clock ever write? | **Never.** A slipped `when` rolls into Today as a derived view rule. Nothing promotes an item to Live, adds it to Focus, or moves it because a day arrived: every device would race to do it. |
| Calendar surface | **Two lenses over the same rows.** Upcoming becomes the agenda (day sections, both dates). A month grid joins as a sibling lens, reusing the corvu calendar already under the date picker. Day granularity only: no hour grid, no durations, no overlap. |
| Export / CalDAV | **Deferred.** Mapping is recorded below. A subscribable feed needs a server that can read items, which the E2EE server cannot; a non-E2EE CalDAV carve-out is a separate conversation. |
| Schema | **Additive within v4.** No break, no import step. |

## Semantics

| | before the day | on the day | after the day, still Open |
|---|---|---|---|
| `deadline` | upcoming | Today, warning tone | Today, overdue tone (red) |
| `when` | upcoming | Today, neutral tone | Today, slipped tone (muted), never red |

A slipped `when` stays in Today until the item is ticked, binned, or
rescheduled. That is the user's decision to make, not the clock's, and a
"slipped" bucket that ages out is the pile people learn to skip (same
reasoning as folding overdue into Today, `deadlineGroups.ts`).

Done and binned items keep both fields untouched, as they keep `deadline`
today. Views filter on lifecycle; the fields are never cleared by a
transition. Restore brings the dates back with the item.

`when` and `deadline` are independent. Neither derives from the other and
neither is required by the other.

## Field: `when`

Item register, string, optional. Add to the `Item` table in `data-model.md`:

```
When      = Date | DateTime
Date      = YYYY "-" MM "-" DD                  ; 10 chars, floating calendar date
DateTime  = Date "T" HH ":" MM                  ; 16 chars, floating wall-clock
; reserved, rejected until fixed-instant support lands:
Fixed     = DateTime "[" IanaZone "]"           ; RFC 9557, e.g. 2026-07-13T14:00[Australia/Melbourne]
```

- Absent ≡ unset. Clearing deletes the key (as `deadline` does).
- Validation: `Date` uses the existing calendar-date check (month range,
  day-in-month, leap years). `DateTime` adds `HH` in `00..=23` and `MM` in
  `00..=59`. Seconds are never stored. Anything else, including a bracketed
  suffix, is rejected with `Invalid`. Input is trimmed before validation, as
  `parse_deadline` does; the stored value is the normalised form.
- **All-day** ≡ 10-character value. There is no default time and no end time.
  On the day, an all-day `when` is owed all day and sorts ahead of every timed
  row.
- **Sort key** is the raw string. `2026-07-13` < `2026-07-13T09:00` <
  `2026-07-13T14:00`, so untimed rows lead their day with no special casing.
- **Day key** is the first ten characters, shared with `deadline`. Every
  bucketing and comparison between the two fields runs on the day key.
- **Floating**: a `when` renders as the same wall-clock value on every device
  regardless of zone. Never construct a `Date` from the string with
  `new Date(stamp)` (UTC parse shifts the day in negative-offset zones); split
  the parts and build local, as `parseLocalDateParts` does. Time formatting
  respects the existing time-format preference (`format.tsx`).
- **Reserved suffix**: the validator accepts exactly 10 or 16 characters.
  When fixed instants land, the suffix becomes a strict superset, old data
  needs no migration, and an absent suffix continues to mean floating. An
  IANA name rather than an offset, because an offset pinned today is wrong for
  a future date after the next DST change. Old clients treat an unparseable
  value as absent, matching the `DefaultView` rule in `board.md`.

## Mutation and events

- `set_item_when(item_id, when: Option<&str>)`: `Some(value)` validates per
  the grammar and writes the `when` register with the normalised value;
  `None` deletes the key. One commit. Rejects malformed values with
  `Invalid`. Mirrors `set_item_deadline` exactly.
- `AppEvent::ItemWhenChanged { id, when: Option<String> }`, the raw value
  after the write. `ItemAdded` gains a `when` field. The wasm event dispatch
  gains `itemWhenChanged` and `itemAdded.when`.
- Export dump (`ItemDump`) gains `when`, skipped when unset so existing dumps
  stay byte-identical. Import accepts it and validates.
- wasm: `setItemWhen(itemId, when?: string)` on both engine surfaces, next to
  `setItemDeadline`.
- Search (`spec/search.md`) does not tokenise either date. A date query
  belongs to the calendar lens, not the palette.
- Focus (`spec/focus.md`) is untouched. A `when` is not a deferred Focus
  entry; on its day the item surfaces in Today and the user pulls it into
  Focus from there. Focus stays curated.

## Agenda (Upcoming, generalised)

Upcoming keeps its token, nav entry, and shape. `groupByDeadline` becomes
`groupByDay` over both fields:

- **Rows** are Open items with a `when` or a `deadline` (or both).
- **Placement**: an item appears exactly once, on its *placement day*, the
  earlier of its `when` day and its `deadline` day, each clamped to today.
  So a past date of either kind lands in Today, and a future `when` with a
  slipped `deadline` lands in Today (it is owed now).
- **Tone** of a row is the most urgent of: overdue (deadline day < today),
  today-warning (deadline day = today), slipped (when day < today), neutral.
- **Within a day**, order by the raw string of the field that placed the row,
  then `created_at`. Today's fold keeps overdue deadlines first, oldest first,
  then slipped whens, oldest first, then today's own rows.
- **Badges**: the placing date is carried by the day header and not repeated,
  except in Today where a past date shows its actual date (existing
  `pastAsDate` rule). The other field, when present, shows as its own badge so
  a row reads "Sat 13 · due 31 Oct". Timed rows show the time as a leading
  label.
- Today is always the first group, empty if nothing is due, so the surface
  anchors on the current day.
- Still not a `Dnd` listbox in this phase; drag-to-reschedule is Phase 3.

## Month grid (new lens, `calendar`)

A sibling of the agenda, not a per-list view: a workspace-level lens like
Upcoming, Done, and Bin.

- One month at a time, Monday or Sunday start per locale, today highlighted.
  Built on `@corvu/calendar`, which already backs the date picker.
- Each day cell shows up to a small fixed number of row titles in placement
  order, then a "+k" overflow. Tone follows the agenda rules, so overdue and
  slipped rows are visible at a glance in Today's cell only (past cells show
  nothing: the fold moved their rows to Today).
- Clicking a day opens the agenda anchored on that day (the agenda gains an
  optional anchor day; Today stays the first group when the anchor is today).
  Clicking a title opens the task surface as agenda rows do.
- Keyboard: arrows move the focused day, PageUp/PageDown move months, Enter
  opens the agenda on the day. The grid itself is `tabIndex=-1` like every
  other chrome surface; keyboard nav enters through the palette or the nav
  shortcut.
- No hour rows, no week view, no durations. Those are the calendar app's.

## Reschedule

Drag a row between agenda day sections, or between grid cells, to reschedule.

- For a row placed by `when`: write `set_item_when` with the day replaced and
  the time part kept.
- For a row placed by `deadline` only: write `set_item_deadline`.
- A row with both moves its `when`; the deadline is a commitment and moves
  only through the explicit control.
- Drop on Today from a slipped state clears the slipped tone without any
  other change.

Requires the agenda to become a keyed listbox with group headers, which the
current flat virtualised list cannot host. Phase 3.

## Task surface and rows

- The task dialog and side panel gain a **When** control beside Deadline,
  same badge-with-popover pattern as `DeadlineField`: Set date…, Today,
  Tomorrow, Remove. Set date… opens the shared calendar modal, which gains an
  optional time input (blank ≡ all-day). Changing the date keeps the time;
  Remove clears both.
- `WhenBadge` beside `DeadlineBadge` on list rows and board cards. When both
  are set, `when` renders first. Muted on done/binned items as deadline is.
- Row context menus gain the same quick actions for When.
- i18n: a `when` message group mirroring `deadline` (label, unset, today,
  tomorrow, slipped, time-of-day formatting defers to the existing
  preference).

## URLs

`spec/urls.md` gains a token:

```
token = ... | "upcoming" | "calendar" | ...
```

`upcoming` stays the agenda. `calendar` is the month grid. A day anchor
(`upcoming_2026-07-13`, `calendar_2026-07`) is the obvious extension; not in
the first cut, but the underscore form is reserved for it.

## CLI

`spec/cli.md` Items gains:

- `airday when <item_id> <YYYY-MM-DD[THH:MM] | ->`: set or clear (`-`) the
  `when` register.
- `airday deadline <item_id> <YYYY-MM-DD | ->`: set or clear the deadline.
  The CLI has no deadline verb today; add both together.
- `airday agenda [--days N]`: the agenda as text, one day section per line
  group, default 14 days plus Today's fold.
- `ls` shows a trailing `@<when>` and `!<deadline>` when set.

## iCalendar mapping (recorded, not built)

An Airday item is a `VTODO`: `DTSTART` is `when`, `DUE` is `deadline`. That
is the correct shape, but calendar displays ignore `VTODO` (Apple Calendar,
Google Calendar; only Reminders-style apps and CalDAV task clients read them).
Anything meant to appear on a calendar must be a `VEVENT`:

| Airday | iCalendar |
|---|---|
| `when` = `2026-07-13` | `DTSTART;VALUE=DATE:20260713`, `DTEND;VALUE=DATE:20260714` (exclusive end, added at export) |
| `when` = `2026-07-13T14:00` | `DTSTART:20260713T140000` (floating: no `Z`, no `TZID`). Apple renders in the viewer's zone; Google pins to the calendar's zone at import. |
| `when` = `...T14:00[Zone]` (future) | `DTSTART;TZID=Zone:20260713T140000` |
| `deadline` | all-day `VEVENT` with a "Due:" summary prefix, since `VEVENT` has no due slot |

Delivery paths, all client-side because the server cannot read items: a
one-shot `.ics` export from web or CLI; native clients writing through
EventKit (which does take `VTODO` into Reminders). A server-side feed or
CalDAV endpoint would need an explicit non-E2EE carve-out and is out of scope
here.

## Deferred, with their extension points

- **Recurrence.** Likely form: an optional `repeat` register `{ every, unit }`
  with `unit` in day/week/month/year; ticking Done spawns a successor with
  `when` advanced and the done item kept, so creation-to-done stats stay
  honest. No RRULE.
- **Fixed instants.** The bracketed suffix above. Flipping the default means
  writers append the device zone; sorting then needs instant normalisation
  for mixed values, which is why it waits.
- **Export**, per the mapping above.
- **CalDAV carve-out.** Separate conversation.
- **Week view, durations, end times, hour grid.** Not planned.

## Testing

- Core unit tests: grammar acceptance (10 and 16 chars, hour and minute
  bounds, trimming, normalisation), rejection of seconds, offsets, bracketed
  suffixes; set/clear round-trip; event payloads; dump round-trip with and
  without `when`.
- `deadlineGroups.test.ts` becomes the `groupByDay` suite: placement day,
  clamping, tone precedence, within-day ordering including timed rows, items
  with both fields.
- CLI system test: `when` set on one device, observed on the other after
  sync, cleared, observed cleared.
- Web: typecheck plus source reading (no browser automation here).

## Phases

0. **Core, wasm, CLI.** Field, validator, mutation, events, dump, wasm
   bindings, `when` / `deadline` / `agenda` verbs. Amend `data-model.md`,
   `cli.md`. Unit and system tests.
1. **Web field and agenda.** Store field and mutation, `WhenBadge`, When
   control with time input, `groupByDay`, agenda tone rules, i18n. Amend
   `urls.md` for the reserved anchor form.
2. **Month grid.** `calendar` token, nav entry, palette entry, grid lens,
   agenda anchor.
3. **Reschedule.** Agenda as a keyed grouped listbox, drag between days and
   cells.
