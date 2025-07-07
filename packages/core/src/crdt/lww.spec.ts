import { expect, test } from "bun:test";
import { LWWRegister, LWW, LWWRegisterString } from "./lww";
import { Builder, ByteBuffer } from "flatbuffers";
import { LWWRegisterStringProto } from "../proto";

test("LWWRegister parsing", async () => {
  const utc = 1750820219953;
  const pid = 1750820210000;
  const manualTS = [utc, pid, 0];
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

test.only("LWWRegisterString flat buffer serialisation & deserialisation", async () => {
  const gen = new LWW(1234);
  const lww = new LWWRegisterString({
    timestamp: gen.timestamp(),
    data: "hello",
  });
  const builder = new Builder(1024);
  const lwwOffset = lww.addToFlatBuffer(builder);
  builder.finish(lwwOffset);
  const uint8 = builder.asUint8Array();
  let bb = new ByteBuffer(uint8);
  let parsedLWW = LWWRegisterStringProto.getRootAsLWWRegisterStringProto(bb);
  console.log(parsedLWW.data());
});
