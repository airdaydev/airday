import { describe, expect, test } from "bun:test";
import { applyDelta, diffToDelta, transformOffset } from "../src/notesDelta.ts";

describe("diffToDelta", () => {
  test("equal strings yield null", () => {
    expect(diffToDelta("abc", "abc")).toBeNull();
  });
  test("insert at end", () => {
    expect(diffToDelta("hello", "hello!")).toEqual([{ retain: 5 }, { insert: "!" }]);
  });
  test("insert at start and delete in the middle", () => {
    expect(diffToDelta("", "a")).toEqual([{ insert: "a" }]);
    expect(diffToDelta("abcd", "ad")).toEqual([{ retain: 1 }, { delete: 2 }]);
    expect(diffToDelta("abcd", "aXd")).toEqual([{ retain: 1 }, { delete: 2 }, { insert: "X" }]);
  });
  test("never splits a surrogate pair at a boundary", () => {
    // 😀 = \ud83d\ude00, 😁 = \ud83d\ude01: they share the high surrogate.
    const ops = diffToDelta("a😀", "a😁");
    expect(ops).toEqual([{ retain: 1 }, { delete: 2 }, { insert: "😁" }]);
    // Common low surrogate at the end: 🙀 = \ud83d\ude40, 🚀 = \ud83d\ude80.
    expect(diffToDelta("😀b", "😁b")).toEqual([{ delete: 2 }, { insert: "😁" }]);
  });
  test("round-trips through applyDelta", () => {
    for (const [a, b] of [
      ["", "x"],
      ["hello world", "hello brave new world"],
      ["a😀b", "a😀😀b"],
      ["line1\nline2", "line1\nline1.5\nline2"],
      ["same prefix and suffix", "same and suffix"],
    ] as const) {
      const ops = diffToDelta(a, b);
      expect(ops === null ? a : applyDelta(a, ops)).toBe(b);
    }
  });
});

describe("transformOffset", () => {
  test("insert before the caret shifts it", () => {
    expect(transformOffset(3, [{ insert: "ab" }])).toBe(5);
    expect(transformOffset(3, [{ retain: 1 }, { insert: "ab" }])).toBe(5);
  });
  test("insert exactly at the caret pushes it along", () => {
    expect(transformOffset(3, [{ retain: 3 }, { insert: "ab" }])).toBe(5);
  });
  test("insert after the caret leaves it", () => {
    expect(transformOffset(3, [{ retain: 4 }, { insert: "ab" }])).toBe(3);
  });
  test("delete before / across / after the caret", () => {
    expect(transformOffset(5, [{ retain: 1 }, { delete: 2 }])).toBe(3);
    expect(transformOffset(5, [{ retain: 4 }, { delete: 3 }])).toBe(4);
    expect(transformOffset(5, [{ retain: 6 }, { delete: 3 }])).toBe(5);
  });
});
