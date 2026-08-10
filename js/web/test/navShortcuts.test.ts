// The 1–4 digit shortcuts' decision logic: which fixed nav view a keydown
// targets, and when it must be a no-op. The overlay / editable-surface
// guards are centralized in `onGlobalKey` (overlay.ts) and are not
// re-tested here; the modifier guard belongs to the mapping itself.

import { describe, expect, test } from "bun:test";

import { digitNavTarget } from "../src/navShortcuts.ts";

const key = (
  k: string,
  mods: Partial<
    Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">
  > = {},
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("digitNavTarget", () => {
  test("1–3 map to Focus / Inbox / Done regardless of bin state", () => {
    for (const binCount of [0, 5]) {
      expect(digitNavTarget(key("1"), binCount)).toEqual({ kind: "focus" });
      expect(digitNavTarget(key("2"), binCount)).toEqual({
        kind: "list",
        id: "inbox",
      });
      expect(digitNavTarget(key("3"), binCount)).toEqual({ kind: "done" });
    }
  });

  test("4 targets the Bin only while it holds items", () => {
    // Mirrors the nav: an empty Bin has no row, so 4 must be a no-op.
    expect(digitNavTarget(key("4"), 1)).toEqual({ kind: "bin" });
    expect(digitNavTarget(key("4"), 0)).toBeNull();
  });

  test("any modifier disqualifies the key", () => {
    // Cmd+1 etc. belong to the browser (tab switching); never hijack them.
    for (const mods of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
    ] as const) {
      expect(digitNavTarget(key("1", mods), 5)).toBeNull();
      expect(digitNavTarget(key("4", mods), 5)).toBeNull();
    }
  });

  test("non-digit and out-of-range keys are ignored", () => {
    for (const k of ["0", "5", "9", "a", "Enter", "[", " "]) {
      expect(digitNavTarget(key(k), 5)).toBeNull();
    }
  });
});
