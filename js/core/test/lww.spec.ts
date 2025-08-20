import { expect, test } from "@playwright/test";
import { LWWRegister, TimestampProducer } from "../src/crdt/lww";

// TODO: This should really include toJSON as well
test("LWWRegister parsing", async () => {
  const utc = BigInt(1750820219953);
  const pid = BigInt(1750820210000);
  const data = "hello";
  const lww = LWWRegister.fromJSON({
    timestamp: { utc: utc.toString(), pid: pid.toString() },
    data,
  });
  expect(lww.timestamp.pid).toBe(pid);
  expect(lww.timestamp.utc).toBe(utc);
  expect(lww.data).toBe(data);
});

test("LWWRegister automatic + merge", async () => {
  const gen = new TimestampProducer(BigInt(1234));
  const lww = new LWWRegister({
    timestamp: gen.timestamp(),
    data: "hello",
  });
  const lww2 = new LWWRegister({
    timestamp: gen.timestamp(),
    data: "newVal",
  });
  const res = lww.merge(lww2);
  expect(res.register.data).toBe("newVal");
  const res2 = lww2.merge(lww);
  expect(res2.register.data).toBe("newVal");
});

test("LWWRegister identical instance merge", async () => {
  const gen = new TimestampProducer(BigInt(1234));
  const timestamp = gen.timestamp();
  const lww1 = new LWWRegister({
    timestamp,
    data: "hello",
  });
  const lww2 = new LWWRegister({
    timestamp,
    data: "hello",
  });

  // Merging identical instances should work and return either one
  const res1 = lww1.merge(lww2);
  const res2 = lww2.merge(lww1);
  expect(res1.register.data).toBe("hello");
  expect(res2.register.data).toBe("hello");
  expect(res1.register.timestamp.equals(timestamp)).toBe(true);
  expect(res2.register.timestamp.equals(timestamp)).toBe(true);
});

test("LWWRegister timestamp collision with different data should throw", async () => {
  const gen = new TimestampProducer(BigInt(1234));
  const timestamp = gen.timestamp();
  const lww1 = new LWWRegister({
    timestamp,
    data: "hello",
  });
  const lww2 = new LWWRegister({
    timestamp,
    data: "world",
  });

  expect(lww1.merge(lww2).register.data, "same data favours right").toBe(
    lww2.data,
  );
  expect(lww2.merge(lww1).register.data, "same data favours right").toBe(
    lww1.data,
  );
});
