// Name matcher behind the task dialog's move-to-list combobox. Shares the
// search index's tokenizer, so the folding rules from spec/search.md
// "Tokenization" apply here too.

import { describe, expect, test } from "bun:test";

import { matchesName } from "../src/search.ts";

describe("matchesName", () => {
  test("an empty or whitespace-only query matches everything", () => {
    expect(matchesName("Work", "")).toBe(true);
    expect(matchesName("Work", "   ")).toBe(true);
  });

  test("matches on a token prefix, not just the whole name", () => {
    expect(matchesName("Roadmap", "road")).toBe(true);
    expect(matchesName("Roadmap", "roadmap")).toBe(true);
    expect(matchesName("Roadmap", "roadmaps")).toBe(false);
  });

  test("prefixes any token, not only the first", () => {
    expect(matchesName("Q3 roadmap", "road")).toBe(true);
    expect(matchesName("Q3 roadmap", "q3")).toBe(true);
  });

  test("every query token must land, in any order", () => {
    expect(matchesName("Q3 roadmap", "q road")).toBe(true);
    expect(matchesName("Q3 roadmap", "road q")).toBe(true);
    expect(matchesName("Q3 roadmap", "q4 road")).toBe(false);
  });

  test("mid-token substrings do not match", () => {
    expect(matchesName("Roadmap", "adm")).toBe(false);
  });

  test("folds case and accents both ways", () => {
    expect(matchesName("Artículos", "art")).toBe(true);
    expect(matchesName("Artículos", "articulos")).toBe(true);
    expect(matchesName("Articulos", "artículos")).toBe(true);
    expect(matchesName("WORK", "wo")).toBe(true);
  });

  test("punctuation is a separator on both sides", () => {
    expect(matchesName("PR #142", "142")).toBe(true);
    expect(matchesName("PR #142", "#142")).toBe(true);
    expect(matchesName("Home/Errands", "errands")).toBe(true);
  });
});
