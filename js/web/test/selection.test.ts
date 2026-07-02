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
});
