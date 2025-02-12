import { describe, test } from "vitest";
import { localZeroDate } from "./time";

describe("localZeroDate", () => {
  test("date converts correctly", (t) => {
    const utcDate = new Date(Date.UTC(2006, 4, 3));
    const localDate = localZeroDate(utcDate);
    t.expect(localDate.getFullYear()).toBe(2006);
    t.expect(localDate.getHours()).toBe(0);
    t.expect(localDate.getMinutes()).toBe(0);
    t.expect(localDate.getSeconds()).toBe(0);
    t.expect(localDate.getMilliseconds()).toBe(0);
    const hours = localDate.getTimezoneOffset() / 60;
    t.expect(utcDate.getHours() + hours).equals(0);
  });
});

describe.only("localZeroDate", () => {
  test("date converts correctly", (t) => {
    const utcDate = new Date(Date.UTC(2025, 0, 31));
    const localDate = localZeroDate(utcDate);
    t.expect(localDate.getFullYear()).toBe(2025);
    t.expect(localDate.getDate()).toBe(31);
    t.expect(localDate.getMonth()).toBe(0);
    t.expect(localDate.getHours()).toBe(0);
    t.expect(localDate.getMinutes()).toBe(0);
    t.expect(localDate.getSeconds()).toBe(0);
    t.expect(localDate.getMilliseconds()).toBe(0);
    const hours = localDate.getTimezoneOffset() / 60;
    t.expect(utcDate.getHours() + hours).equals(0);
  });
});
