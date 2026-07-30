// Emoji picker's search index. Runs against the real vendored dataset — it's
// checked in and static, so there's no fixture to drift out of sync, and
// asserting on emoji people actually search for is the point.
//
// Ranking assertions are deliberately about *ordering*, not exact scores;
// the weights in `emoji/search.ts` are tuning knobs, the relative ordering
// they produce is the contract.

import { describe, expect, test } from "bun:test";

import type { Emoji } from "../src/emoji/data.ts";
import { createEmojiIndex } from "../src/emoji/search.ts";
import raw from "../src/emoji/emoji-data.json" with { type: "json" };

type EmojiRow = [string, string, number, number, string, string];

// TS infers the imported rows as `(string | number)[][]` — positional tuples
// aren't recoverable from JSON. Assert through `unknown` to the real shape.
const ALL: Emoji[] = (raw as unknown as { emoji: EmojiRow[] }).emoji.map(
  ([emoji, annotation, group, version, tags, shortcodes]) => ({
    emoji,
    annotation,
    group,
    version,
    tags,
    shortcodes,
  }),
);

const index = createEmojiIndex(ALL, Infinity);

/** Position of an emoji in the results, or -1. */
const rank = (query: string, emoji: string): number =>
  index.query(query, 200).findIndex((e) => e.emoji === emoji);

describe("emoji dataset", () => {
  test("is non-trivial and carries no component group", () => {
    expect(ALL.length).toBeGreaterThan(1500);
    // Group 2 (skin-tone / hair modifiers) is stripped at vendoring time —
    // they're combining characters, not pickable emoji.
    expect(ALL.some((e) => e.group === 2)).toBe(false);
  });

  test("every group in the tab strip is populated", () => {
    for (const g of [0, 1, 3, 4, 5, 6, 7, 8, 9]) {
      expect(index.byGroup(g).length).toBeGreaterThan(0);
    }
  });
});

describe("createEmojiIndex#query", () => {
  test("an empty query returns nothing — the caller shows groups instead", () => {
    expect(index.query("")).toEqual([]);
    expect(index.query("   ")).toEqual([]);
  });

  test("finds the obvious emoji for an obvious word", () => {
    expect(index.query("rocket")[0].emoji).toBe("🚀");
    expect(index.query("birthday cake")[0].emoji).toBe("🎂");
    // Asserted by name, not grapheme: the dataset carries the VS16-qualified
    // "👍️", which is not the bare "👍" a source literal usually contains.
    expect(index.query("thumbs up")[0].annotation).toBe("thumbs up");
  });

  test("matches on shortcode as well as name", () => {
    // "tada" is a shortcode only; it appears in no annotation.
    expect(index.query("tada")[0].emoji).toBe("🎉");
  });

  test("matches on tags — words in neither the name nor a shortcode", () => {
    // "lol" is a tag on 😂 (annotation: "face with tears of joy").
    expect(rank("lol", "😂")).toBeGreaterThanOrEqual(0);
  });

  test("prefixes match, so a half-typed query is useful", () => {
    expect(rank("roc", "🚀")).toBeGreaterThanOrEqual(0);
    expect(rank("umbre", "☂️")).toBeGreaterThanOrEqual(0);
  });

  test("an exact hit outranks a prefix hit on the same field", () => {
    // "smile" is a shortcode of 😄 exactly, and a prefix of the "smiley"
    // shortcode on 😃 — the exact match must come first.
    expect(rank("smile", "😄")).toBeLessThan(rank("smile", "😃"));
  });

  test("naming the thing outright beats a same-strength token hit", () => {
    // Both 🔥 ("fire") and ❤️‍🔥 ("heart on fire", shortcode `heart_on_fire`)
    // carry an exact `fire` token; only the first *is* fire.
    expect(index.query("fire", 200)[0].emoji).toBe("🔥");
    // Same shape: "cat" is 🐈's whole name and a token of many cat faces.
    expect(index.query("cat", 200)[0].annotation).toBe("cat");
  });

  test("on a score tie the shorter, more specific name wins", () => {
    // "arrow" is an exact token in both "up arrow" and "heart with arrow".
    expect(rank("arrow", "⬆️")).toBeLessThan(rank("arrow", "💘"));
  });

  test("multiple tokens are ANDed", () => {
    expect(rank("red heart", "❤️")).toBeGreaterThanOrEqual(0);
    // Both tokens must land somewhere; "heart" alone matches, "zzzz" never
    // does, so the conjunction is empty.
    expect(index.query("heart zzzznotaword")).toEqual([]);
  });

  test("token order does not matter", () => {
    expect(index.query("cake birthday")[0].emoji).toBe(
      index.query("birthday cake")[0].emoji,
    );
  });

  test("folds case and accents via the shared tokenizer", () => {
    expect(index.query("ROCKET")[0].emoji).toBe("🚀");
    expect(index.query("Rocket")[0].emoji).toBe("🚀");
  });

  test("respects the result limit", () => {
    // "face" is on a great many emoji.
    expect(index.query("face", 10).length).toBe(10);
    expect(index.query("face", 200).length).toBeGreaterThan(10);
  });
});

describe("createEmojiIndex#get", () => {
  test("resolves a stored grapheme back to its metadata", () => {
    expect(index.get("🚀")?.annotation).toBe("rocket");
  });

  test("returns undefined for a non-dataset grapheme", () => {
    expect(index.get("§")).toBeUndefined();
  });
});

describe("version filtering", () => {
  test("drops emoji newer than the device's supported version", () => {
    // 🫠 "melting face" is Unicode emoji 14.0.
    expect(index.get("🫠")).toBeDefined();

    const old = createEmojiIndex(ALL, 13.1);
    expect(old.get("🫠")).toBeUndefined();
    expect(old.get("🚀")).toBeDefined();
    // Filtered emoji are gone from search and group browsing alike.
    expect(old.query("melting face").some((e) => e.emoji === "🫠")).toBe(false);
    expect(old.byGroup(0).some((e) => e.emoji === "🫠")).toBe(false);
  });
});
