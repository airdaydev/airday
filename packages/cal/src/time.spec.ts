import { describe, test, expect } from "vitest";
import { localZeroDate } from "./time";

describe("localZeroDate", () => {
  test("date converts correctly", () => {
    const utcDate = new Date(Date.UTC(2006, 4));
    const localDate = localZeroDate(utcDate);
  });
});
