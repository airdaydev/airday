// NOTE: This file has been vibecoded and remains unchecked in-depth

interface SpanLog {
  timestamp: number;
  message: string;
  data?: Record<string, any>;
}

// Minimal types for compatibility
type HrTime = [number, number];
type Attributes = Record<string, any>;

interface ULSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startTime: HrTime;
  readonly endTime: HrTime;
  readonly duration: HrTime;
  readonly status: { code: number; message?: string };
  readonly attributes: Attributes;
  readonly events: SpanLog[];
  readonly ended: boolean;
}

interface OTLPKeyValue {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
  };
}

interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OTLPKeyValue[];
  events: {
    timeUnixNano: string;
    name: string;
    attributes: OTLPKeyValue[];
  }[];
  status: {
    code: number;
    message?: string;
  };
}

interface TracePayload {
  resourceSpans: {
    resource: {
      attributes: OTLPKeyValue[];
    };
    scopeSpans: {
      scope: {
        name: string;
        version: string;
      };
      spans: OTLPSpan[];
    }[];
  }[];
}

// Ultra-light JSON tracer
class ULTracer {
  private serviceName: string;
  private spans: ULSpan[] = [];
  private resource: { attributes: Attributes };

  constructor(serviceName: string) {
    if (!serviceName) {
      throw new Error("ULTracer: serviceName required");
    }
    this.serviceName = serviceName;
    this.resource = { attributes: { "service.name": serviceName } };
  }

  startSpan(name: string, parentSpanId?: string): ULSpan {
    const traceId = this.generateId();
    const spanId = this.generateId();
    const startTime = this.hrTime();

    const span: ULSpan = {
      name,
      traceId,
      spanId,
      parentSpanId,
      startTime,
      endTime: [0, 0],
      duration: [0, 0],
      status: { code: 0 }, // UNSET
      attributes: {},
      events: [],
      ended: false,
    };

    this.spans.push(span);
    return span;
  }

  endSpan(span: ULSpan): ULSpan {
    const endTime = this.hrTime();
    const duration = this.calculateDuration(span.startTime, endTime);

    // Update span (breaking readonly for internal implementation)
    (span as any).endTime = endTime;
    (span as any).duration = duration;
    (span as any).ended = true;

    // Only set status to OK if it's not already set to ERROR
    if (span.status.code !== 2) {
      (span as any).status = { code: 1 }; // OK
    }

    return span;
  }

  addTag(span: ULSpan, key: string, value: any): void {
    (span.attributes as any)[key] = value;
  }

  log(span: ULSpan, message: string, data: Record<string, any> = {}): void {
    const event: SpanLog = {
      timestamp: Date.now(),
      message,
      data,
    };
    (span.events as any).push(event);
  }

  flush(): ULSpan[] {
    const traces = this.spans.slice();
    this.spans = [];
    return traces;
  }

  // Create OTLP-compliant JSON payload
  createPayload(): TracePayload {
    const spans = this.flush();

    return {
      resourceSpans: [
        {
          resource: {
            attributes: this.attributesToOTLP(this.resource.attributes),
          },
          scopeSpans: [
            {
              scope: {
                name: "ul-tracer",
                version: "1.0.0",
              },
              spans: spans.map((span) => this.spanToOTLP(span)),
            },
          ],
        },
      ],
    };
  }

  // Send to endpoint
  async send(endpoint: string): Promise<void> {
    const payload = this.createPayload();

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Encoding": "gzip",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error("ULTracer: Failed to send traces:", error);
      throw error;
    }
  }

  // Convert span to OTLP format
  private spanToOTLP(span: ULSpan): OTLPSpan {
    return {
      traceId: this.toHex(span.traceId, 32),
      spanId: this.toHex(span.spanId, 16),
      parentSpanId: span.parentSpanId
        ? this.toHex(span.parentSpanId, 16)
        : undefined,
      name: span.name,
      kind: 1, // SPAN_KIND_INTERNAL
      startTimeUnixNano: this.hrTimeToNanos(span.startTime).toString(),
      endTimeUnixNano: this.hrTimeToNanos(span.endTime).toString(),
      attributes: this.attributesToOTLP(span.attributes),
      events: span.events.map((event) => ({
        timeUnixNano: (event.timestamp * 1000000).toString(), // Convert ms to ns
        name: event.message,
        attributes: this.attributesToOTLP(event.data || {}),
      })),
      status: {
        code: span.status.code,
        message: span.status.message || "",
      },
    };
  }

  // Convert attributes to OTLP format
  private attributesToOTLP(attributes: Attributes): OTLPKeyValue[] {
    return Object.entries(attributes).map(([key, value]) => ({
      key,
      value: this.valueToOTLP(value),
    }));
  }

  // Convert value to OTLP value format
  private valueToOTLP(value: any): OTLPKeyValue["value"] {
    if (typeof value === "string") {
      return { stringValue: value };
    } else if (typeof value === "number") {
      return Number.isInteger(value)
        ? { intValue: value.toString() }
        : { doubleValue: value };
    } else if (typeof value === "boolean") {
      return { boolValue: value };
    } else {
      return { stringValue: String(value) };
    }
  }

  // Convert ID to hex format with padding
  private toHex(id: string, length: number): string {
    // Create a simple hash from the string ID
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      const char = id.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert to hex and pad to required length
    const hex = Math.abs(hash).toString(16);
    const randomSuffix = Math.random().toString(16).substring(2);
    const combined = (hex + randomSuffix).substring(0, length);
    return combined.padStart(length, "0");
  }

  // Convert HrTime to nanoseconds
  private hrTimeToNanos(hrTime: HrTime): bigint {
    const [seconds, nanos] = hrTime;
    return BigInt(seconds) * BigInt(1000000000) + BigInt(Math.floor(nanos));
  }

  // Utility methods
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private hrTime(): HrTime {
    const now = performance.now();
    const seconds = Math.floor(now / 1000);
    const nanoseconds = Math.floor((now % 1000) * 1000000);
    return [seconds, nanoseconds];
  }

  private calculateDuration(start: HrTime, end: HrTime): HrTime {
    const startMs = start[0] * 1000 + start[1] / 1000000;
    const endMs = end[0] * 1000 + end[1] / 1000000;
    const durationMs = endMs - startMs;
    return [Math.floor(durationMs / 1000), (durationMs % 1000) * 1000000];
  }

  // Convenience methods
  withSpan<T>(name: string, fn: (span: ULSpan) => T, parentSpanId?: string): T {
    const span = this.startSpan(name, parentSpanId);
    try {
      const result = fn(span);
      this.endSpan(span);
      return result;
    } catch (error) {
      this.addTag(span, "error", true);
      this.addTag(span, "error.message", String(error));
      (span as any).status = { code: 2, message: String(error) }; // ERROR
      this.endSpan(span);
      throw error;
    }
  }

  async withSpanAsync<T>(
    name: string,
    fn: (span: ULSpan) => Promise<T>,
    parentSpanId?: string,
  ): Promise<T> {
    const span = this.startSpan(name, parentSpanId);
    try {
      const result = await fn(span);
      this.endSpan(span);
      return result;
    } catch (error) {
      this.addTag(span, "error", true);
      this.addTag(span, "error.message", String(error));
      (span as any).status = { code: 2, message: String(error) }; // ERROR
      this.endSpan(span);
      throw error;
    }
  }
}

export default ULTracer;
export { type ULSpan, type SpanLog, type TracePayload };
