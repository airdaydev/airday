// Day bucketing behind the Upcoming view: Today always leads and absorbs
// overdue items, and same-day items share a group.

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
  test("buckets by day, soonest first, overdue folded into Today", () => {
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
      ["2026-09-02", "today", 3],
      ["2026-09-03", "future", 2],
    ]);
    expect(groups[0]!.label).toBe("Today");
    expect(groups[1]!.label).toBe("Tomorrow");
    // Overdue leads Today, oldest first, then today's own.
    expect(groups[0]!.items.map((i) => i.deadline)).toEqual([
      "2026-08-01",
      "2026-08-30",
      "2026-09-02",
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

  test("Today leads even when nothing is due on it", () => {
    const groups = groupByDeadline(
      [item("2026-09-05")],
      TODAY,
      LABELS,
      "en",
    );
    expect(groups.map((g) => g.key)).toEqual([TODAY, "2026-09-05"]);
    expect(groups[0]!.items).toEqual([]);
  });

  test("empty input still yields an empty Today", () => {
    const groups = groupByDeadline([], TODAY, LABELS, "en");
    expect(groups.map((g) => g.key)).toEqual([TODAY]);
    expect(groups[0]!.items).toEqual([]);
  });
});
