// Day bucketing behind the Upcoming view: overdue folds into one leading group, same-day items share a
// group, and the optional Today anchor lands after Overdue.

import { describe, expect, test } from "bun:test";

import { groupByDeadline } from "../src/deadlineGroups.ts";
import type { ItemView } from "../src/sync/store.ts";

const LABELS = { overdue: "Overdue", today: "Today", tomorrow: "Tomorrow" };
const TODAY = "2026-09-02";

let seq = 0;
function item(
  deadline: string | undefined,
  extra: Partial<ItemView> = {},
): ItemView {
  seq += 1;
  return {
    id: `i${seq}`,
    listId: "inbox",
    text: `item ${seq}`,
    notes: "",
    state: "backlog",
    createdAt: seq,
    lifecycleAt: seq,
    deadline,
    ...extra,
  } as ItemView;
}

describe("groupByDeadline", () => {
  test("buckets by day, soonest first, overdue folded together", () => {
    const groups = groupByDeadline(
      [
        item("2026-09-03"),
        item("2026-08-30"),
        item("2026-09-02"),
        item("2026-08-01"),
        item("2026-09-03"),
      ],
      TODAY,
      LABELS,
      "en",
    );
    expect(groups.map((g) => [g.key, g.urgency, g.items.length])).toEqual([
      ["overdue", "overdue", 2],
      ["2026-09-02", "today", 1],
      ["2026-09-03", "future", 2],
    ]);
    expect(groups[0]!.label).toBe("Overdue");
    expect(groups[1]!.label).toBe("Today");
    expect(groups[2]!.label).toBe("Tomorrow");
    // Overdue keeps date order within the fold.
    expect(groups[0]!.items.map((i) => i.deadline)).toEqual([
      "2026-08-01",
      "2026-08-30",
    ]);
  });

  test("skips undated, done and binned items", () => {
    const groups = groupByDeadline(
      [
        item(undefined),
        item("2026-09-02", { state: "done" }),
        item("2026-09-02", { binnedAt: 1 }),
        item("2026-09-02"),
      ],
      TODAY,
      LABELS,
      "en",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(1);
  });

  test("ensureToday inserts an empty Today after Overdue", () => {
    const groups = groupByDeadline(
      [item("2026-08-30"), item("2026-09-05")],
      TODAY,
      LABELS,
      "en",
      { ensureToday: true },
    );
    expect(groups.map((g) => g.key)).toEqual([
      "overdue",
      TODAY,
      "2026-09-05",
    ]);
    expect(groups[1]!.items).toEqual([]);
  });

  test("ensureToday leads when nothing is overdue", () => {
    const groups = groupByDeadline([], TODAY, LABELS, "en", {
      ensureToday: true,
    });
    expect(groups.map((g) => g.key)).toEqual([TODAY]);
  });
});
