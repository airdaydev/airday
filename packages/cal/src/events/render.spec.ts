import { describe, test } from "vitest";
import { EventRenderer } from "./render";
import { localMidnight } from "../time";

process.env.TZ = "Australia/Sydney";

describe("updateCache", () => {
  const now = Date.now();
  const today = localMidnight(new Date()).valueOf();
  const yesterday = today - 864e5;
  const tomorrow = today + 864e5;
  const renderer = new EventRenderer(true);
  test("events end up in correct buckets", (t) => {
    const a = {
      id: (Math.random() * 1000000).toFixed(),
      title: "yesterday - 2 days",
      start: now - 864e5,
      end: now + 864e5,
    };
    const b = {
      id: (Math.random() * 1000000).toFixed(),
      title: "now - 1 day",
      start: now,
      end: now + 864e5,
    };
    const c = {
      id: (Math.random() * 1000000).toFixed(),
      title: "now - 1 day",
      start: now,
      end: now + 864e5,
    };
    renderer.updateCache(
      [a, b, c],
      [yesterday - 864e5 * 4, tomorrow + 864e5 * 4],
    );
    t.expect(renderer.cache.size).toBe(3); // yesterday, today, tomorrow
    t.expect(Array.isArray(renderer.cache.get(today))).to.be.true;
    t.expect(renderer.cache.get(today)?.length).toBe(3);
  });
});
