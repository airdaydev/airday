import { describe, expect, test } from "bun:test";
import {
  BOARD_VIEW,
  LIST_VIEW,
  encodeView,
  parseView,
  viewsEqual,
  type ViewSpec,
} from "../src/view.ts";

describe("view encoding", () => {
  test("round-trips every canonical form", () => {
    const forms: ViewSpec[] = [
      LIST_VIEW,
      BOARD_VIEW,
      { board: true, showDone: false },
    ];
    for (const v of forms) {
      expect(parseView(encodeView(v))).toEqual(v);
    }
  });

  test("the list lens carries no Done-lane state", () => {
    // Canonical: two specs that render identically must encode
    // identically, or "is this already the default?" goes wrong.
    expect(encodeView({ board: false, showDone: false })).toBe("list");
    expect(viewsEqual({ board: false, showDone: false }, LIST_VIEW)).toBe(true);
  });

  test("unknown / absent values read as no view", () => {
    // A newer client's lens must degrade to "fall back", never to a
    // wrong render.
    expect(parseView("calendar")).toBeNull();
    expect(parseView("")).toBeNull();
    expect(parseView(undefined)).toBeNull();
    expect(parseView(null)).toBeNull();
  });

  test("matches the core's encoded forms", () => {
    // These three strings are the wire contract with `DefaultView` in
    // core/src/doc.rs — changing one side alone breaks saved defaults.
    expect(encodeView(LIST_VIEW)).toBe("list");
    expect(encodeView(BOARD_VIEW)).toBe("board");
    expect(encodeView({ board: true, showDone: false })).toBe("board:nodone");
  });
});
