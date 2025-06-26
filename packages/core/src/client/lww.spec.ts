import { expect, test } from "bun:test";
import { LWWRegister, LWW } from "./lww";

test("LWWRegister parsing", async () => {
  const utc = 1750820219953;
  const pid = 1750820210000;
  const manualTS = `${utc}/${pid}/0`;
  const data = "hello";
  const lww = LWWRegister.fromJSON([manualTS, data]);
  expect(lww.timestamp.pid).toBe(pid);
  expect(lww.timestamp.utc).toBe(utc);
  expect(lww.data).toBe(data);
});

test("LWWRegister automatic + merge", async () => {
  const gen = new LWW(1234);
  const lww = new LWWRegister({
    timestamp: gen.timestamp(),
    data: "hello",
  });
  const lww2 = new LWWRegister({
    timestamp: gen.timestamp(),
    data: "newVal",
  });
  const res = lww.merge(lww2);
  expect(res.data).toBe("newVal");
  const res2 = lww2.merge(lww);
  expect(res2.data).toBe("newVal");
});
