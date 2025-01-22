import { describe, test } from "vitest";
import { updateCache } from "./worker";

describe("updateCache", () => {
  const now = Date.now();
  const yesterday = now - 864e5;
  const tomorrow = now + 864e5;
  const cache = new Map<number, Set<any>>();
  test("events end up in correct buckets", (t) => {
    const a = {
      title: "yesterday - 2 days",
      start: now - 864e5,
      end: now + 864e5,
    };
    updateCache(cache, [a], [yesterday - 1, tomorrow + 1]);
    console.log(cache);
  });
});
