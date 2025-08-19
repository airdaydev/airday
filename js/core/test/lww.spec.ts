import { expect, test } from "@playwright/test";
import {
  LWWRegister,
  TimestampProducer,
  LWWRegisterString,
} from "../src/crdt/lww";
import { Builder, ByteBuffer } from "flatbuffers";
import { LWWRegisterStringProto } from "../src/proto";

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

test("LWWRegisterString flat buffer serialisation & deserialisation", async () => {
  const data = "hello";
  const gen = new TimestampProducer(BigInt(1234));
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
  expect(parsedLWW.timestamp()?.utc()).toBe(timestamp.utc);
  expect(parsedLWW.timestamp()?.pid()).toBe(timestamp.pid);
});
