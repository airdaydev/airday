import { expect, test } from "@playwright/test";
import { ChecksumStore } from "./verification";

test("ChecksumStore instantiates clean", async () => {
  const store = new ChecksumStore();
  expect(store.dirty).toBe(false);
  expect(store.years.size).toBe(0);
  expect(store.daysTouched.size).toBe(0);
});

test("Checksums calculated correctly for days on insert", async () => {
  const store = new ChecksumStore();
  const dayMs = 100_000_000;
  const usecs = [
    dayMs * 1000,
    dayMs * 1000 + 500_000,
    dayMs * 1000 + 1_000_000,
  ];
  store.insertDay(dayMs, usecs);

  expect(store.dirty).toBe(true);
  expect(store.daysTouched.size).toBe(1);

  // Verify the day node was created with correct checksum
  const dayNode = store.daysTouched.get(dayMs);
  expect(dayNode).toBeDefined();
  expect(dayNode?.index).toBe(dayMs);

  // Calculate expected checksum (XOR of all usecs)
  const expectedChecksum = usecs.reduce((xor, usec) => xor ^ usec, 0);
  expect(dayNode?.checksum).toBe(expectedChecksum);
});

test("ChecksumStore insertDay validate incorrect days", async () => {
  const store = new ChecksumStore();
  const dayMs = 100_000_000;
  const wrongDayUsec = (dayMs + 100_000_000) * 1000; // next day
  expect(() => {
    store.insertDay(dayMs, [wrongDayUsec]);
  }).toThrow();
});

test("Commit counts", async () => {
  const store = new ChecksumStore();

  // Insert data for multiple days across different months and years
  const day1 = 100_000_000; // Year 0, Month 0
  const day2 = 200_000_000; // Year 0, Month 0
  const day3 = 6_000_000_000; // Year 0, Month 1 (different month)
  const day4 = 60_000_000_000; // Year 1 (different year)

  store.insertDay(day1, [day1 * 1000, day1 * 1000 + 1000]);
  store.insertDay(day2, [day2 * 1000]);
  store.insertDay(day3, [day3 * 1000, day3 * 1000 + 2000]);
  store.insertDay(day4, [day4 * 1000]);

  expect(store.dirty).toBe(true);
  expect(store.daysTouched.size).toBe(4);

  store.commit();

  expect(store.dirty).toBe(false);
  expect(store.daysTouched.size).toBe(0);
  expect(store.years.size).toBe(2); // Two different years

  // Verify year structure
  const year0 = store.years.get(0);
  const year1 = store.years.get(50_000_000_000);

  expect(year0).toBeDefined();
  expect(year1).toBeDefined();
  expect(year0?.children.size).toBe(2); // Two months in year 0
  expect(year1?.children.size).toBe(1); // One month in year 1
});

test("getDay functionality", async () => {
  const store = new ChecksumStore();

  const dayMs = 100_000_000;
  const usecs = [dayMs * 1000, dayMs * 1000 + 1000];

  store.insertDay(dayMs, usecs);
  store.commit();

  const result = store.getDay(dayMs);
  expect(result).not.toBe(false);

  if (result) {
    expect(result.dayNode.index).toBe(dayMs);
    expect(result.dayNode.checksum).toBe(usecs[0] ^ usecs[1]);
    expect(result.monthNode.index).toBe(0);
    expect(result.yearNode.index).toBe(0);
  }

  // Test non-existent day
  const nonExistentDay = store.getDay(999_000_000);
  expect(nonExistentDay).toBe(false);
});

test("clearDay functionality", async () => {
  const store = new ChecksumStore();

  const day1 = 100_000_000;
  const day2 = 200_000_000;

  store.insertDay(day1, [day1 * 1000]);
  store.insertDay(day2, [day2 * 1000]);
  store.commit();

  expect(store.getDay(day1)).not.toBe(false);
  expect(store.getDay(day2)).not.toBe(false);

  // Clear one day
  store.clearDay(day1);
  expect(store.getDay(day1)).toBe(false);
  expect(store.getDay(day2)).not.toBe(false);

  // Clear the last day in the month/year - should clean up empty containers
  store.clearDay(day2);
  expect(store.getDay(day2)).toBe(false);
  expect(store.years.size).toBe(0); // Should have cleaned up empty year
});

test("ChecksumStore - clearDay with pending changes throws error", async () => {
  const store = new ChecksumStore();
  const dayMs = 100_000_000;
  store.insertDay(dayMs, [dayMs * 1000]);
  expect(() => {
    store.clearDay(dayMs);
  }).toThrow("can't clear days while there are pending changes");
});

test("ChecksumStore - reset functionality", async () => {
  const store = new ChecksumStore();

  const dayMs = 100_000_000;
  store.insertDay(dayMs, [dayMs * 1000]);
  store.commit();

  expect(store.years.size).toBe(1);

  store.insertDay(dayMs + 100_000_000, [(dayMs + 100_000_000) * 1000]);
  expect(store.dirty).toBe(true);

  store.reset();

  expect(store.dirty).toBe(false);
  expect(store.years.size).toBe(0);
  expect(store.daysTouched.size).toBe(0);
});

test("ChecksumStore - checksum calculation verification", async () => {
  const store = new ChecksumStore();

  // Test with known values to verify XOR calculation
  const dayMs = 100_000_000;
  const usecs = [
    (dayMs + 1000) * 1000,
    (dayMs + 2000) * 1000,
    (dayMs + 3000) * 1000,
  ];
  const expectedDayChecksum = usecs[0] ^ usecs[1] ^ usecs[2]; // Should be 0

  store.insertDay(dayMs, usecs);
  store.commit();

  const result = store.getDay(dayMs);
  if (result) {
    expect(result.dayNode.checksum).toBe(expectedDayChecksum);
    expect(result.monthNode.checksum).toBe(expectedDayChecksum); // Only one day
    expect(result.yearNode.checksum).toBe(expectedDayChecksum); // Only one month
  }
});

test("ChecksumStore - multiple days in same month", async () => {
  const store = new ChecksumStore();

  const day1 = 100_000_000;
  const day2 = 200_000_000; // Same month (both < 5_000_000_000)

  const day1Us = (day1 + 3000) * 1000;
  const day2Us = (day2 + 6000) * 1000;

  store.insertDay(day1, [day1Us]);
  store.insertDay(day2, [day2Us]);
  store.commit();

  const result1 = store.getDay(day1);
  const result2 = store.getDay(day2);

  if (result1 && result2) {
    // Both days should share the same month and year nodes
    expect(result1.monthNode).toBe(result2.monthNode);
    expect(result1.yearNode).toBe(result2.yearNode);

    // Month checksum should be XOR of both day checksums
    expect(result1.monthNode.checksum).toBe(day1Us ^ day2Us);
  }
});

test("ChecksumStore - edge case with empty usecs array", async () => {
  const store = new ChecksumStore();
  const dayMs = 100_000_000;

  store.insertDay(dayMs, []);

  const dayNode = store.daysTouched.get(dayMs);
  expect(dayNode).toBeUndefined();
});
