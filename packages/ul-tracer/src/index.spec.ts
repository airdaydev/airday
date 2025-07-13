import { test, expect, describe } from "bun:test";
import ULTracer from "./index";

// NOTE: This file has been vibecoded and remains unchecked in-depth

describe("ULTracer OTLP Implementation", () => {
  test("should create tracer with service name", () => {
    const tracer = new ULTracer("test-service");
    expect(tracer).toBeDefined();

    const payload = tracer.createPayload();
    expect(payload.resourceSpans).toHaveLength(1);
    expect(payload.resourceSpans[0].resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "test-service" } },
    ]);
  });

  test("should throw error without service name", () => {
    expect(() => new ULTracer("")).toThrow("ULTracer: serviceName required");
  });

  test("should create and end spans", () => {
    const tracer = new ULTracer("test-service");

    const span = tracer.startSpan("test-operation");
    expect(span.name).toBe("test-operation");
    expect(span.traceId).toBeTruthy();
    expect(span.spanId).toBeTruthy();
    expect(span.ended).toBe(false);

    tracer.endSpan(span);
    expect(span.ended).toBe(true);
    expect(span.status.code).toBe(1); // OK
  });

  test("should add tags to spans", () => {
    const tracer = new ULTracer("test-service");
    const span = tracer.startSpan("test-operation");

    tracer.addTag(span, "http.method", "GET");
    tracer.addTag(span, "http.status_code", 200);
    tracer.addTag(span, "user.id", "user123");

    expect(span.attributes["http.method"]).toBe("GET");
    expect(span.attributes["http.status_code"]).toBe(200);
    expect(span.attributes["user.id"]).toBe("user123");
  });

  test("should log events to spans", () => {
    const tracer = new ULTracer("test-service");
    const span = tracer.startSpan("test-operation");

    tracer.log(span, "Processing request", { user_id: "123" });
    tracer.log(span, "Request completed");

    expect(span.events).toHaveLength(2);
    expect(span.events[0].message).toBe("Processing request");
    expect(span.events[0].data).toEqual({ user_id: "123" });
    expect(span.events[1].message).toBe("Request completed");
  });

  test("should create nested spans", () => {
    const tracer = new ULTracer("test-service");

    const parentSpan = tracer.startSpan("parent-operation");
    const childSpan = tracer.startSpan("child-operation", parentSpan.spanId);

    expect(childSpan.parentSpanId).toBe(parentSpan.spanId);
    expect(childSpan.traceId).toBeTruthy();
    expect(childSpan.spanId).toBeTruthy();
    expect(childSpan.spanId).not.toBe(parentSpan.spanId);
  });

  test("should flush spans", () => {
    const tracer = new ULTracer("test-service");

    const span1 = tracer.startSpan("op1");
    const span2 = tracer.startSpan("op2");
    tracer.endSpan(span1);
    tracer.endSpan(span2);

    const flushed = tracer.flush();
    expect(flushed).toHaveLength(2);
    expect(flushed[0].name).toBe("op1");
    expect(flushed[1].name).toBe("op2");

    // Should be empty after flush
    const flushed2 = tracer.flush();
    expect(flushed2).toHaveLength(0);
  });

  test("should create valid OTLP payload", () => {
    const tracer = new ULTracer("test-service");

    const span = tracer.startSpan("test-operation");
    tracer.addTag(span, "key", "value");
    tracer.log(span, "test event", { data: "test" });
    tracer.endSpan(span);

    const payload = tracer.createPayload();

    expect(payload.resourceSpans).toHaveLength(1);
    expect(payload.resourceSpans[0].resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "test-service" } },
    ]);
    expect(payload.resourceSpans[0].scopeSpans).toHaveLength(1);
    expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
    expect(payload.resourceSpans[0].scopeSpans[0].scope.name).toBe("ul-tracer");

    const serialized = JSON.stringify(payload);
    expect(serialized).toBeTruthy();

    // Should be valid JSON
    const parsed = JSON.parse(serialized);
    expect(parsed.resourceSpans).toHaveLength(1);
  });

  test("should handle withSpan convenience method", () => {
    const tracer = new ULTracer("test-service");

    const result = tracer.withSpan("test-operation", (span) => {
      tracer.addTag(span, "key", "value");
      return "success";
    });

    expect(result).toBe("success");

    const payload = tracer.createPayload();
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("test-operation");
    expect(spans[0].attributes).toContainEqual({
      key: "key",
      value: { stringValue: "value" },
    });
  });

  test("should handle withSpan errors", () => {
    const tracer = new ULTracer("test-service");

    expect(() => {
      tracer.withSpan("test-operation", (span) => {
        throw new Error("Test error");
      });
    }).toThrow("Test error");

    const payload = tracer.createPayload();
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(2); // ERROR
    expect(spans[0].attributes).toContainEqual({
      key: "error",
      value: { boolValue: true },
    });
    expect(spans[0].attributes).toContainEqual({
      key: "error.message",
      value: { stringValue: "Error: Test error" },
    });
  });

  test("should handle withSpanAsync convenience method", async () => {
    const tracer = new ULTracer("test-service");

    const result = await tracer.withSpanAsync(
      "async-operation",
      async (span) => {
        tracer.addTag(span, "async", true);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return "async-success";
      },
    );

    expect(result).toBe("async-success");

    const payload = tracer.createPayload();
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("async-operation");
    expect(spans[0].attributes).toContainEqual({
      key: "async",
      value: { boolValue: true },
    });
  });

  test("should handle withSpanAsync errors", async () => {
    const tracer = new ULTracer("test-service");

    await expect(
      tracer.withSpanAsync("async-operation", async (span) => {
        throw new Error("Async error");
      }),
    ).rejects.toThrow("Async error");

    const payload = tracer.createPayload();
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe(2); // ERROR
    expect(spans[0].attributes).toContainEqual({
      key: "error",
      value: { boolValue: true },
    });
  });

  test("should calculate span duration", () => {
    const tracer = new ULTracer("test-service");
    const span = tracer.startSpan("timed-operation");

    // Simulate some work
    const start = performance.now();
    while (performance.now() - start < 5) {} // Busy wait for 5ms

    tracer.endSpan(span);

    expect(span.duration[0]).toBeGreaterThanOrEqual(0);
    expect(span.duration[1]).toBeGreaterThan(0);
  });

  test("should handle large payloads", () => {
    const tracer = new ULTracer("large-test");

    // Create many spans
    for (let i = 0; i < 1000; i++) {
      const span = tracer.startSpan(`operation-${i}`);
      tracer.addTag(span, "iteration", i);
      tracer.addTag(span, "type", "batch");
      tracer.log(span, "Processing", { index: i });
      tracer.endSpan(span);
    }

    const payload = tracer.createPayload();
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(1000);

    // Should serialize without issues
    const serialized = JSON.stringify(payload);
    expect(serialized.length).toBeGreaterThan(0);

    // Should be valid JSON
    const parsed = JSON.parse(serialized);
    expect(parsed.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1000);
  });

  test("should generate unique IDs", () => {
    const tracer = new ULTracer("id-test");

    const ids = new Set();
    for (let i = 0; i < 1000; i++) {
      const span = tracer.startSpan("test");
      ids.add(span.traceId);
      ids.add(span.spanId);
    }

    // Should have 2000 unique IDs (1000 trace IDs + 1000 span IDs)
    expect(ids.size).toBe(2000);
  });

  test("should maintain performance at scale", () => {
    const tracer = new ULTracer("perf-test");
    const spanCount = 10000;

    const start = performance.now();

    for (let i = 0; i < spanCount; i++) {
      const span = tracer.startSpan(`perf-operation-${i}`);
      tracer.addTag(span, "iteration", i);
      tracer.endSpan(span);
    }

    const payload = tracer.createPayload();
    const serialized = JSON.stringify(payload);

    const end = performance.now();
    const duration = end - start;
    const perSpan = duration / spanCount;

    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(spanCount);
    expect(perSpan).toBeLessThan(0.01); // Should be under 0.01ms per span
    expect(serialized.length).toBeGreaterThan(0);
  });

  test("should produce OTLP-compliant output", () => {
    const tracer = new ULTracer("otlp-test-service");

    const span = tracer.startSpan("test-operation");
    tracer.addTag(span, "http.method", "GET");
    tracer.addTag(span, "http.status_code", 200);
    tracer.addTag(span, "success", true);
    tracer.addTag(span, "latency", 42.5);
    tracer.log(span, "Request processed", {
      user_id: "123",
      region: "us-east",
    });
    tracer.endSpan(span);

    const payload = tracer.createPayload();

    // Verify top-level OTLP structure
    expect(payload).toHaveProperty("resourceSpans");
    expect(payload.resourceSpans).toHaveLength(1);

    const resourceSpan = payload.resourceSpans[0];

    // Verify resource structure
    expect(resourceSpan).toHaveProperty("resource");
    expect(resourceSpan.resource).toHaveProperty("attributes");
    expect(Array.isArray(resourceSpan.resource.attributes)).toBe(true);
    expect(resourceSpan.resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "otlp-test-service" },
    });

    // Verify scope spans structure
    expect(resourceSpan).toHaveProperty("scopeSpans");
    expect(resourceSpan.scopeSpans).toHaveLength(1);

    const scopeSpan = resourceSpan.scopeSpans[0];
    expect(scopeSpan).toHaveProperty("scope");
    expect(scopeSpan.scope).toEqual({
      name: "ul-tracer",
      version: "1.0.0",
    });

    // Verify spans structure
    expect(scopeSpan).toHaveProperty("spans");
    expect(scopeSpan.spans).toHaveLength(1);

    const otlpSpan = scopeSpan.spans[0];

    // Verify span fields are OTLP compliant
    expect(otlpSpan).toHaveProperty("traceId");
    expect(otlpSpan).toHaveProperty("spanId");
    expect(otlpSpan).toHaveProperty("name", "test-operation");
    expect(otlpSpan).toHaveProperty("kind", 1); // SPAN_KIND_INTERNAL
    expect(otlpSpan).toHaveProperty("startTimeUnixNano");
    expect(otlpSpan).toHaveProperty("endTimeUnixNano");
    expect(otlpSpan).toHaveProperty("attributes");
    expect(otlpSpan).toHaveProperty("events");
    expect(otlpSpan).toHaveProperty("status");

    // Verify trace/span IDs are hex format
    expect(otlpSpan.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(otlpSpan.spanId).toMatch(/^[0-9a-f]{16}$/);

    // Verify timestamps are nanosecond strings
    expect(typeof otlpSpan.startTimeUnixNano).toBe("string");
    expect(typeof otlpSpan.endTimeUnixNano).toBe("string");
    expect(parseInt(otlpSpan.endTimeUnixNano)).toBeGreaterThan(
      parseInt(otlpSpan.startTimeUnixNano),
    );

    // Verify attributes are in OTLP format
    expect(Array.isArray(otlpSpan.attributes)).toBe(true);
    expect(otlpSpan.attributes).toContainEqual({
      key: "http.method",
      value: { stringValue: "GET" },
    });
    expect(otlpSpan.attributes).toContainEqual({
      key: "http.status_code",
      value: { intValue: "200" },
    });
    expect(otlpSpan.attributes).toContainEqual({
      key: "success",
      value: { boolValue: true },
    });
    expect(otlpSpan.attributes).toContainEqual({
      key: "latency",
      value: { doubleValue: 42.5 },
    });

    // Verify events are in OTLP format
    expect(Array.isArray(otlpSpan.events)).toBe(true);
    expect(otlpSpan.events).toHaveLength(1);
    expect(otlpSpan.events[0]).toHaveProperty("timeUnixNano");
    expect(otlpSpan.events[0]).toHaveProperty("name", "Request processed");
    expect(otlpSpan.events[0]).toHaveProperty("attributes");
    expect(otlpSpan.events[0].attributes).toContainEqual({
      key: "user_id",
      value: { stringValue: "123" },
    });
    expect(otlpSpan.events[0].attributes).toContainEqual({
      key: "region",
      value: { stringValue: "us-east" },
    });

    // Verify status is in OTLP format
    expect(otlpSpan.status).toHaveProperty("code", 1); // STATUS_CODE_OK
    expect(otlpSpan.status).toHaveProperty("message");

    // Verify the JSON is serializable and valid
    const serialized = JSON.stringify(payload);
    expect(serialized.length).toBeGreaterThan(0);
    const parsed = JSON.parse(serialized);
    expect(parsed.resourceSpans[0].scopeSpans[0].spans[0].name).toBe(
      "test-operation",
    );
  });
});
