import { describe, test } from "vitest";
import { EventRenderer } from "./render";

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
    renderer.updateCache([a], [yesterday - 1, tomorrow + 1]);
    console.log(renderer.cache.size);
  });
});
