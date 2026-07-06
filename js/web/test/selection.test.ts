// Order-version guard on DndSelection.updateOrder (see
// spec/list-perf-plan.md, "dnd cascade"): the same array reference must
// be a no-op — controller paths and per-scroll getRenderState calls
// hand back the order they already indexed — while a replaced array
// (DndSource's only update mode) must reindex.

import { describe, expect, test } from "bun:test";
import { DndSelection } from "../src/dnd/core/selection.ts";

describe("DndSelection.updateOrder guard", () => {
  test("same reference is a no-op; new reference reindexes", () => {
    const order = ["a", "b", "c"];
    const sel = new DndSelection(order);
    // Block spanning a→c resolves through orderIndex/indexToKey, so
    // selected keys observe exactly what updateOrder indexed.
    sel.selectOnly("a");
    sel.extendActive("c");
    expect(sel.getSelectedKeys()).toEqual(["a", "b", "c"]);

    // In-place mutation + same reference: guard skips the rebuild, so
    // the inserted key is invisible. DndSource never mutates in place —
    // this asserts the redundant-call fast path, not a supported input.
    order.splice(2, 0, "d");
    sel.updateOrder(order);
    expect(sel.getSelectedKeys()).toEqual(["a", "b", "c"]);

    // A new array (how real order changes always arrive) reindexes:
    // the a→c block now spans the inserted "d".
    sel.updateOrder([...order]);
    expect(sel.getSelectedKeys()).toEqual(["a", "b", "d", "c"]);
  });

  test("getSelectedKeySet memoizes until a mutation or reindex", () => {
    const order = ["a", "b", "c"];
    const sel = new DndSelection(order);
    sel.selectOnly("a");
    sel.extendActive("b");

    const first = sel.getSelectedKeySet();
    expect([...first]).toEqual(["a", "b"]);
    // Hot path: repeated reads (per scroll/drag frame) return the
    // cached instance.
    expect(sel.getSelectedKeySet()).toBe(first);

    // Any block mutation invalidates.
    sel.extendActive("c");
    const second = sel.getSelectedKeySet();
    expect(second).not.toBe(first);
    expect([...second]).toEqual(["a", "b", "c"]);

    // A reindex invalidates too (block ranges resolve through the
    // order), while a same-reference updateOrder does not.
    sel.updateOrder(order);
    expect(sel.getSelectedKeySet()).toBe(second);
    sel.updateOrder([...order]);
    expect(sel.getSelectedKeySet()).not.toBe(second);
  });
});

describe("DndSelection.setSelectedKeys", () => {
  test("replaces the selection with exactly the given keys", () => {
    const order = ["a", "b", "c", "d", "e"];
    const sel = new DndSelection(order);
    sel.selectOnly("a");
    // The board makes just-dropped rows the target column's selection.
    sel.setSelectedKeys(["c", "d"]);
    expect(sel.getSelectedKeys()).toEqual(["c", "d"]);
  });

  test("coalesces adjacent keys and keeps non-adjacent ones separate", () => {
    const order = ["a", "b", "c", "d", "e"];
    const sel = new DndSelection(order);
    // Passed out of order and non-contiguous: merge sorts by position and
    // coalesces only b+c, leaving e as its own block.
    sel.setSelectedKeys(["c", "e", "b"]);
    expect(sel.getSelectedKeys()).toEqual(["b", "c", "e"]);
    const s = sel.getSelection();
    expect(s.blocks.length).toBe(2);
  });

  test("empty keys clears the selection", () => {
    const sel = new DndSelection(["a", "b"]);
    sel.selectOnly("a");
    sel.setSelectedKeys([]);
    expect(sel.hasSelection()).toBe(false);
    expect(sel.getActiveBlock()).toBeNull();
  });
});
