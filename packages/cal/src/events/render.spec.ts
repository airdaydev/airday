import { describe, test } from "vitest";
import { EventRenderer } from "./render";

process.env.TZ = "Australia/Sydney";

describe("updateCache", () => {
  const now = Date.now();
  const yesterday = now - 864e5;
  const tomorrow = now + 864e5;
  const renderer = new EventRenderer(true);
  test("events end up in correct buckets", (t) => {
    const a = {
      title: "yesterday - 2 days",
      start: now - 864e5,
      end: now + 864e5,
    };
    renderer.updateCache([a], [yesterday - 864e5 * 4, tomorrow + 864e5 * 4]);
    t.expect(renderer.cache.size).toBe(3); // yesterday, today, tomorrow
  });
});
