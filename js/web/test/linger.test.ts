import { describe, expect, test } from "bun:test";

import { restoreCapturedPositions } from "../src/linger.ts";

function restore(
  live: string[],
  captured: Array<{ index: number; value: string }>,
): string[] {
  restoreCapturedPositions(live, captured);
  return live;
}

describe("restoreCapturedPositions", () => {
  test("restores a top-down Done sequence without moving later rows up", () => {
    expect(
      restore(
        ["a", "c", "e"],
        [
          { index: 1, value: "b" },
          { index: 2, value: "d" },
        ],
      ),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("restores a bottom-up Done sequence", () => {
    expect(
      restore(
        ["a", "c", "e"],
        [
          { index: 3, value: "d" },
          { index: 1, value: "b" },
        ],
      ),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("restores a mixed sequence using each capture-time index", () => {
    expect(
      restore(
        ["b", "d", "f"],
        [
          { index: 4, value: "e" },
          { index: 0, value: "a" },
          { index: 1, value: "c" },
        ],
      ),
    ).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
