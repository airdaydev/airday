import { Builder } from "flatbuffers";
import { LWWRegisterStringProto, LWWTimestampProto } from "../proto";
import { type TypeOf, v, ensure } from "suretype";

// BigInt process ID generated from high entropy-source, if available
export const genPid = (): bigint => {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const array = new Uint32Array(2);
    crypto.getRandomValues(array);
    // Create 64-bit BigInt from two 32-bit values
    return (BigInt(array[0]) << 32n) | BigInt(array[1]);
  }
  // Fallback for environments without crypto
  return BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
};

const initialOffsetMs = Date.now() - performance.now();
const nextMicro = () =>
  BigInt(Math.floor(initialOffsetMs + performance.now() / 1000));

interface TimestampConstructorOps {
  utc: bigint;
  pid: bigint;
}

export class LWWTimestamp {
  utc: bigint; // Monotonic client wall clock in microseconds
  pid: bigint; // Process id
  constructor(opts: TimestampConstructorOps) {
    this.utc = opts.utc;
    this.pid = opts.pid;
  }
  greaterThan(other: LWWTimestamp): boolean {
    if (this.utc !== other.utc) {
      return this.utc > other.utc;
    }
    if (this.pid !== other.pid) {
      return this.pid > other.pid;
    }
    return false;
  }
  equals(other: LWWTimestamp): boolean {
    return this.utc === other.utc && this.pid === other.pid;
  }
  addToFlatBuffer(builder: Builder) {
    return LWWTimestampProto.createLWWTimestampProto(
      builder,
      Number(this.utc),
      Number(this.pid),
    );
  }
  toJSON() {
    return {
      utc: this.utc.toString(),
      pid: this.pid.toString(),
    };
  }
}

export class TimestampProducer {
  private pid: bigint;
  private lastUtc: bigint = 0n;
  constructor(pid: bigint = genPid()) {
    this.pid = pid;
  }
  timestamp(): LWWTimestamp {
    const now = nextMicro();
    // Ensures monotonic timestamp + uniqueness
    if (now <= this.lastUtc) {
      this.lastUtc++;
    } else {
      this.lastUtc = now;
    }
    return new LWWTimestamp({
      utc: this.lastUtc,
      pid: this.pid,
    });
  }
}

export const globalTSProducer = new TimestampProducer();

interface LWWRegisterConstructorOpts<T> {
  timestamp?: LWWTimestamp;
  data: T;
}

const LwwJSON = v.object({
  timestamp: v
    .object({
      utc: v.string().required(),
      pid: v.string().required(),
    })
    .required(),
  data: v.any(),
});

export class LWWRegister<T> {
  timestamp: LWWTimestamp;
  data: T;
  dirty = false;
  constructor(opts: LWWRegisterConstructorOpts<T>) {
    this.timestamp = opts.timestamp || globalTSProducer.timestamp();
    this.data = opts.data;
    this.dirty = this.dirty ?? false;
  }
  static fromJSON<T>(json: any): LWWRegister<T> {
    ensure(LwwJSON, json);
    let typed = json as TypeOf<typeof LwwJSON>;
    const timestamp = new LWWTimestamp({
      utc: BigInt(typed.timestamp.utc),
      pid: BigInt(typed.timestamp.pid),
    });
    return new LWWRegister<T>({ timestamp, data: typed.data as T });
  }
  toJSON() {
    return {
      data: this.data,
      timestamp: this.timestamp.toJSON(),
      dirty: this.dirty,
    };
  }
  merge(other: LWWRegister<T>): LWWRegister<T> {
    // If timestamps are equal, check data consistency
    if (this.timestamp.equals(other.timestamp)) {
      // Same timestamp with different data is an error
      if (this.data !== other.data) {
        throw new Error(
          "Timestamp collision detected on merge between different data",
        );
      }
      // Same timestamp with same data - this is the same instance, return either one
      return this;
    }

    // Different timestamps - last write wins
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

export const TimestampSchema = v.object({
  utc: v.string(),
  pid: v.string(),
});

export const LWWSerialiseSchema = v.object({
  data: v.any(),
  timestamp: TimestampSchema,
});
