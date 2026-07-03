import { describe, expect, test } from "bun:test";

import { planReorderMoves } from "../src/reorder.ts";

function apply(ids: readonly string[], moves: ReturnType<typeof planReorderMoves>): string[] {
  const out = [...ids];
  for (const move of moves) {
    const from = out.indexOf(move.id);
    expect(from).toBeGreaterThanOrEqual(0);
    out.splice(from, 1);
    out.splice(move.index, 0, move.id);
  }
  return out;
}

describe("planReorderMoves", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];

  test("one row moving down is one move, independent of distance", () => {
    const moves = planReorderMoves(ids, ["a"], null);
    expect(moves).toEqual([{ id: "a", index: 5 }]);
    expect(apply(ids, moves)).toEqual(["b", "c", "d", "e", "f", "a"]);
  });

  test("one row moving up is one move", () => {
    const moves = planReorderMoves(ids, ["f"], "b");
    expect(moves).toEqual([{ id: "f", index: 1 }]);
    expect(apply(ids, moves)).toEqual(["a", "f", "b", "c", "d", "e"]);
  });

  test("contiguous selection preserves order in both directions", () => {
    const down = planReorderMoves(ids, ["b", "c"], null);
    expect(down).toHaveLength(2);
    expect(apply(ids, down)).toEqual(["a", "d", "e", "f", "b", "c"]);

    const up = planReorderMoves(ids, ["e", "f"], "b");
    expect(up).toHaveLength(2);
    expect(apply(ids, up)).toEqual(["a", "e", "f", "b", "c", "d"]);
  });

  test("discontiguous selection becomes one ordered block", () => {
    const moves = planReorderMoves(ids, ["b", "d"], null);
    expect(moves).toHaveLength(2);
    expect(apply(ids, moves)).toEqual(["a", "c", "e", "f", "b", "d"]);
  });

  test("dropping in the same effective slot emits no moves", () => {
    expect(planReorderMoves(ids, ["b", "c"], "d")).toEqual([]);
  });

  test("all selections and destinations converge using at most one move per row", () => {
    for (let mask = 1; mask < 1 << ids.length; mask++) {
      const moved = ids.filter((_, i) => (mask & (1 << i)) !== 0);
      const movedSet = new Set(moved);
      const remaining = ids.filter((id) => !movedSet.has(id));
      for (const beforeKey of [...remaining, null]) {
        const insertAt = beforeKey === null ? remaining.length : remaining.indexOf(beforeKey);
        const expected = [...remaining];
        expected.splice(insertAt, 0, ...moved);
        const moves = planReorderMoves(ids, moved, beforeKey);
        expect(moves.length).toBeLessThanOrEqual(moved.length);
        expect(apply(ids, moves)).toEqual(expected);
      }
    }
  });
});
