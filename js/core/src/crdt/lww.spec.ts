import { expect, test } from "bun:test";
import { LWWRegister, TimestampProducer, LWWRegisterString } from "./lww";
import { Builder, ByteBuffer } from "flatbuffers";
import { LWWRegisterStringProto } from "../proto";

test("LWWRegister parsing", async () => {
  const utc = 1750820219953;
  const pid = 1750820210000;
  const data = "hello";
  const lww = LWWRegister.fromJSON({ timestamp: { utc, pid }, data });
  expect(lww.timestamp.pid).toBe(pid);
  expect(lww.timestamp.utc).toBe(utc);
  expect(lww.data).toBe(data);
});

test("LWWRegister automatic + merge", async () => {
  const gen = new TimestampProducer(1234);
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

test("LWWRegister identical instance merge", async () => {
  const gen = new TimestampProducer(1234);
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
  expect(res1.data).toBe("hello");
  expect(res2.data).toBe("hello");
  expect(res1.timestamp.equals(timestamp)).toBe(true);
  expect(res2.timestamp.equals(timestamp)).toBe(true);
});

test("LWWRegister timestamp collision with different data should throw", async () => {
  const gen = new TimestampProducer(1234);
  const timestamp = gen.timestamp();
  const lww1 = new LWWRegister({
    timestamp,
    data: "hello",
  });
  const lww2 = new LWWRegister({
    timestamp,
    data: "world",
  });

  // This should throw an error - same timestamp but different data
  expect(() => lww1.merge(lww2)).toThrow(
    "Timestamp collision detected on merge between different data",
  );
  expect(() => lww2.merge(lww1)).toThrow(
    "Timestamp collision detected on merge between different data",
  );
});

test("LWWRegisterString flat buffer serialisation & deserialisation", async () => {
  const data = "hello";
  const gen = new TimestampProducer(1234);
  const timestamp = gen.timestamp();
  const lww = new LWWRegisterString({
    timestamp,
    data: data,
  });

  const builder = new Builder(1024);
  const lwwOffset = lww.addToFlatBuffer(builder);
  builder.finish(lwwOffset);
  const uint8 = builder.asUint8Array();
  let bb = new ByteBuffer(uint8);
  let parsedLWW = LWWRegisterStringProto.getRootAsLWWRegisterStringProto(bb);
  expect(parsedLWW.data()).toBe(data);
  expect(Number(parsedLWW.timestamp()?.utc())).toBe(timestamp.utc);
  expect(Number(parsedLWW.timestamp()?.pid())).toBe(timestamp.pid);
});
