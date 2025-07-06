import { Builder } from "flatbuffers";
import { LWWRegisterBool as LWWRegisterBoolFB } from "../proto";
// A batched protocol over websockets for creating, deleting, updating items
// Items are based on a custom LWW-Register CRDT - there is really isn't much to it

export const genPid = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

interface TimestampConstructorOps {
  utc?: number;
  pid: number;
  tick?: number;
}

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
  static fromString(tsStr: string) {
    const parts = tsStr.split("/");
    if (parts.length !== 3)
      throw new Error(`Invalid timestamp format ${tsStr}`);
    const [utcRaw, pidRaw, tickRaw] = parts;
    const pid = Number(pidRaw);
    const utc = Number(utcRaw);
    const tick = Number(tickRaw);
    if (isNaN(utc) || isNaN(tick))
      throw new Error(`Invalid timestamp format ${tsStr}`);
    return new LWWTimestamp({
      utc,
      pid,
      tick,
    });
  }
  toArray(): LWWTimestampArr {
    return [this.utc, this.pid, this.tick];
  }
}

export type LWWTimestampArr = [number, number, number];
export type SerialisedLWWRegister<T> = [LWWTimestampArr, T];

interface LWWRegisterConstructorOpts<T> {
  timestamp: LWWTimestamp;
  data: T;
}

export class LWWRegister<T> {
  timestamp: LWWTimestamp;
  data: T;
  constructor(opts: LWWRegisterConstructorOpts<T>) {
    this.timestamp = opts.timestamp;
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
    const timestamp = LWWTimestamp.fromString(json[0]);
    return new LWWRegister<T>({ timestamp, data: json[1] as unknown as T });
  }
  toJSON(): SerialisedLWWRegister<T> {
    return [this.timestamp.toArray(), this.data];
  }
  merge(other: LWWRegister<T>): LWWRegister<T> {
    if (this.timestamp.equals(other.timestamp)) {
      console.warn("Timestamp conflict detected, ignoring merge");
      return this;
    }
    if (this.timestamp.greaterThan(other.timestamp)) {
      return this;
    }
    return other;
  }
}

// function toFlatBuffer() {
//   let builder = new Builder(1024);
//   LWWRegisterBoolFB.createLWWRegisterBool(
//     builder,
//     BigInt(this.timestamp.utc),
//     BigInt(this.timestamp.pid),
//     this.timestamp.tick,
//     this.data,
//   );
// }

export class LWW {
  private pid: number;
  private lastUtc: number = 0;
  private tick: number = 0;
  constructor(pid: number = genPid()) {
    this.pid = pid;
  }
  timestamp(): LWWTimestamp {
    const now = Date.now();
    if (now === this.lastUtc) {
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
  from<T>(data: T) {
    return new LWWRegister<T>({
      timestamp: this.timestamp(),
      data,
    });
  }
}
