import { Tracer, ULSpan, TracerID } from "@airday/tracer";
import { SpanContextProto } from "./proto";

export const tracer = new Tracer("airday_js");

export function spanFromFlatbuffer(ctx: SpanContextProto | null, name: string) {
  if (ctx) {
    const traceId = TracerID.fromFBVector(ctx.traceId);
    const parentSpanId = TracerID.fromBigInt(ctx.spanId()); // bigint
    const span = tracer.startSpan(name, { parentSpanId, traceId });
    return span;
  }
  return tracer.startSpan(name);
}
