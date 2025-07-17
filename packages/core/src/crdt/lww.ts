import { Builder } from "flatbuffers";
import { LWWRegisterStringProto, LWWTimestampProto } from "../proto";

export const genPid = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

interface TimestampConstructorOps {
  utc?: number;
  pid: number;
  tick?: number;
}

export type LWWTimestampArr = [number, number, number];

export class LWWTimestamp {
  utc: number; // Process wall clock
  pid: number; // Process id
  tick: number; // Process tick
  constructor(opts: TimestampConstructorOps) {
    this.utc = opts.utc || Date.now();
    this.pid = opts.pid;
    this.tick = opts.tick || 0;
  }
  greaterThan(other: LWWTimestamp): boolean {
    if (this.utc !== other.utc) {
      return this.utc > other.utc;
    }
    if (this.pid !== other.pid) {
      return this.pid > other.pid;
    }
    return this.tick > other.tick;
  }
  equals(other: LWWTimestamp): boolean {
    return (
      this.utc === other.utc &&
      this.pid === other.pid &&
      this.tick === other.tick
    );
  }
  addToFlatBuffer(builder: Builder) {
    return LWWTimestampProto.createLWWTimestampProto(
      builder,
      this.utc,
      this.pid,
      this.tick,
    );
  }
  toArray(): LWWTimestampArr {
    return [this.utc, this.pid, this.tick];
  }
  static fromArray(arr: LWWTimestampArr) {
    return new LWWTimestamp({
      utc: arr[0],
      pid: arr[1],
      tick: arr[2],
    });
  }
}

export class TimestampProducer {
  private pid: number;
  private lastUtc: number = 0;
  private tick: number = 0;
  constructor(pid: number = genPid()) {
    this.pid = pid;
  }
  timestamp(): LWWTimestamp {
    const now = Date.now();
    // Ensures monotonic timestamp + uniqueness
    if (now <= this.lastUtc) {
      if (this.tick >= Number.MAX_SAFE_INTEGER) {
        throw new Error(
          "Tick overflow - too many timestamps generated for the same UTC",
        );
      }
      this.tick++;
    } else {
      this.lastUtc = now;
      this.tick = 0;
    }
    return new LWWTimestamp({
      utc: this.lastUtc,
      pid: this.pid,
      tick: this.tick,
    });
  }
}

export const globalTSProducer = new TimestampProducer();

export type SerialisedLWWRegister<T> = [LWWTimestampArr, T];

interface LWWRegisterConstructorOpts<T> {
  timestamp?: LWWTimestamp;
  data: T;
}

export class LWWRegister<T> {
  timestamp: LWWTimestamp;
  data: T;
  constructor(opts: LWWRegisterConstructorOpts<T>) {
    this.timestamp = opts.timestamp || globalTSProducer.timestamp();
    this.data = opts.data;
  }
  static fromJSON<T>(json: any): LWWRegister<T> {
    if (!Array.isArray(json) || json.length !== 2)
      throw new Error("Invalid LWWRegister format");
    // TODO: Replace with validator for complex objects
    if (
      typeof json[1] !== "string" &&
      typeof json[1] !== "boolean" &&
      typeof json[1] !== "number"
    ) {
      throw new Error("LWWRegister only handles strings, booleans and numbers");
    }
    const timestamp = LWWTimestamp.fromArray(json[0]);
    return new LWWRegister<T>({ timestamp, data: json[1] as unknown as T });
  }
  toJSON(): SerialisedLWWRegister<T> {
    return [this.timestamp.toArray(), this.data];
  }
  merge(other: LWWRegister<T>): LWWRegister<T> {
    if (this.timestamp.equals(other.timestamp)) {
      throw new Error("Timestamp collision detected on merge");
    }
    if (this.timestamp.greaterThan(other.timestamp)) {
      return this;
    }
    return other;
  }
}

export class LWWRegisterString extends LWWRegister<string> {
  constructor(opts: LWWRegisterConstructorOpts<string>) {
    super(opts);
  }
  static fromString(string: string) {
    return new LWWRegisterString({
      data: string,
    });
  }
  addToFlatBuffer(builder: Builder) {
    const dataOffset = builder.createString(this.data);
    const tsOffset = this.timestamp.addToFlatBuffer(builder);
    return LWWRegisterStringProto.createLWWRegisterStringProto(
      builder,
      tsOffset,
      dataOffset,
    );
  }
}
