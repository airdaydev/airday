import { describe, expect, test } from "bun:test";
import {
  ALL_LANES,
  BOARD_VIEW,
  LIST_VIEW,
  encodeView,
  parseView,
  viewsEqual,
  withLane,
  type ViewSpec,
} from "../src/view.ts";

const NO_DONE: ViewSpec = {
  board: true,
  lanes: ["backlog", "todo", "in_progress", "review"],
};
const TWO_LANES: ViewSpec = { board: true, lanes: ["in_progress", "done"] };

describe("view encoding", () => {
  test("round-trips every canonical form", () => {
    for (const v of [LIST_VIEW, BOARD_VIEW, NO_DONE, TWO_LANES]) {
      expect(parseView(encodeView(v))).toEqual(v);
    }
  });

  test("the list lens carries no lane state", () => {
    // Canonical: two specs that render identically must encode
    // identically, or "is this already the default?" goes wrong.
    expect(encodeView({ board: false, lanes: ["done"] })).toBe("list");
    expect(viewsEqual({ board: false, lanes: ["done"] }, LIST_VIEW)).toBe(true);
  });

  test("lanes canonicalise to ladder order, full set to bare board", () => {
    expect(encodeView({ board: true, lanes: ["done", "in_progress", "done"] })).toBe(
      "board:in_progress,done",
    );
    expect(encodeView({ board: true, lanes: [...ALL_LANES].reverse() })).toBe("board");
    expect(parseView("board:done,in_progress")).toEqual(TWO_LANES);
    expect(parseView("board:backlog,todo,in_progress,review,done")).toEqual(BOARD_VIEW);
    // An empty set never reaches the register.
    expect(encodeView({ board: true, lanes: [] })).toBe("board");
  });

  test("unknown / absent values read as no view", () => {
    // A newer client's lens (or lane) must degrade to "fall back", never
    // to a wrong render.
    expect(parseView("calendar")).toBeNull();
    expect(parseView("board:")).toBeNull();
    expect(parseView("board:blocked")).toBeNull();
    expect(parseView("board:done,")).toBeNull();
    expect(parseView("")).toBeNull();
    expect(parseView(undefined)).toBeNull();
    expect(parseView(null)).toBeNull();
  });

  test("matches the core's encoded forms", () => {
    // These strings are the wire contract with `DefaultView` in
    // core/src/doc.rs — changing one side alone breaks saved defaults.
    expect(encodeView(LIST_VIEW)).toBe("list");
    expect(encodeView(BOARD_VIEW)).toBe("board");
    expect(encodeView(NO_DONE)).toBe("board:backlog,todo,in_progress,review");
    expect(encodeView(TWO_LANES)).toBe("board:in_progress,done");
  });

  test("withLane toggles one lane and refuses to blank the board", () => {
    expect(withLane(BOARD_VIEW, "done", false)).toEqual(NO_DONE);
    expect(withLane(NO_DONE, "done", true)).toEqual(BOARD_VIEW);
    const only: ViewSpec = { board: true, lanes: ["done"] };
    expect(withLane(only, "done", false)).toBeNull();
    // Showing an already-visible lane is a no-op.
    expect(withLane(BOARD_VIEW, "todo", true)).toEqual(BOARD_VIEW);
  });
});
