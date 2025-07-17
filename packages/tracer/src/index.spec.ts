// @ts-ignore
import { test, expect, describe } from "bun:test";
import { Tracer } from "./index";

// NOTE: This file has been vibecoded and remains unchecked in-depth

describe("Tracer OTLP Implementation", () => {
  test("should create tracer with service name", () => {
    const tracer = new Tracer("test-service", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: false,
    });
    expect(tracer).toBeDefined();

    const payload = tracer.createPayload();
    expect(payload.resourceSpans).toHaveLength(1);
    expect(payload.resourceSpans[0].resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "test-service" } },
    ]);
  });

  test("should throw error without service name", () => {
    expect(() => new Tracer("")).toThrow("Tracer: serviceName required");
  });

  test("should create and end spans", () => {
    const tracer = new Tracer("test-service", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: false,
    });

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
    const tracer = new Tracer("test-service", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: false,
    });
    const span = tracer.startSpan("test-operation");

    tracer.addTag(span, "http.method", "GET");
    tracer.addTag(span, "http.status_code", 200);
    tracer.addTag(span, "user.id", "user123");

    expect(span.attributes["http.method"]).toBe("GET");
    expect(span.attributes["http.status_code"]).toBe(200);
    expect(span.attributes["user.id"]).toBe("user123");
  });

  test("should log events to spans", () => {
    const tracer = new Tracer("test-service", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: false,
    });
    const span = tracer.startSpan("test-operation");

    tracer.log(span, "Processing request", { user_id: "123" });
    tracer.log(span, "Request completed");

    expect(span.events).toHaveLength(2);
    expect(span.events[0].message).toBe("Processing request");
    expect(span.events[0].data).toEqual({ user_id: "123" });
    expect(span.events[1].message).toBe("Request completed");
  });

  test("should create nested spans", () => {
    const tracer = new Tracer("test-service", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: false,
    });

    const parentSpan = tracer.startSpan("parent-operation");
    const childSpan = tracer.startSpan("child-operation", parentSpan.spanId);

    expect(childSpan.parentSpanId).toBe(parentSpan.spanId);
    expect(childSpan.traceId).toBeTruthy();
    expect(childSpan.spanId).toBeTruthy();
    expect(childSpan.spanId).not.toBe(parentSpan.spanId);
  });

  test("should flush spans", () => {
    const tracer = new Tracer("test-service", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: false,
    });

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
    const tracer = new Tracer("test-service", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: false,
    });

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
    expect(payload.resourceSpans[0].scopeSpans[0].scope.name).toBe("tracer");

    const serialized = JSON.stringify(payload);
    expect(serialized).toBeTruthy();

    // Should be valid JSON
    const parsed = JSON.parse(serialized);
    expect(parsed.resourceSpans).toHaveLength(1);
  });

  test("should calculate span duration", () => {
    const tracer = new Tracer("test-service", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: false,
    });
    const span = tracer.startSpan("timed-operation");

    // Simulate some work
    const start = performance.now();
    while (performance.now() - start < 5) {} // Busy wait for 5ms

    tracer.endSpan(span);

    expect(span.duration[0]).toBeGreaterThanOrEqual(0);
    expect(span.duration[1]).toBeGreaterThan(0);
  });

  test("should handle large payloads", () => {
    const tracer = new Tracer("large-test", {
      endpoint: "http://localhost:4318/v1/traces",
      maxBufferSize: 1000,
      maxBatchSize: 1001, // Slightly larger than span count to prevent auto-flushing
      flushIntervalMs: 60000, // Very long interval to prevent time-based flushing
      networkEnabled: false,
    });

    // Create many spans
    for (let i = 0; i < 1000; i++) {
      const span = tracer.startSpan(`operation-${i}`);
      tracer.addTag(span, "iteration", i);
      tracer.addTag(span, "type", "batch");
      tracer.log(span, "Processing", { index: i });
      tracer.endSpan(span);
    }

    // Test that spans are properly tracked
    const stats = tracer.getStats();
    expect(stats.spansGenerated).toBe(1000);
    expect(stats.spansBuffered).toBe(1000);

    // Test that we can create a payload with all spans
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
    const tracer = new Tracer("id-test", {
      endpoint: "http://localhost:4318/v1/traces",
      maxBufferSize: 1000,
      networkEnabled: false,
    });

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
    const tracer = new Tracer("perf-test", {
      endpoint: "http://localhost:4318/v1/traces",
      maxBufferSize: 15000, // Larger buffer to handle 10k spans
      maxBatchSize: 15000, // Large batch size to prevent auto-flushing
      flushIntervalMs: 60000, // Very long interval to prevent time-based flushing
      networkEnabled: false,
    });
    const spanCount = 10000;

    const start = performance.now();

    for (let i = 0; i < spanCount; i++) {
      const span = tracer.startSpan(`perf-operation-${i}`);
      tracer.addTag(span, "iteration", i);
      tracer.endSpan(span);
    }

    const end = performance.now();
    const duration = end - start;
    const perSpan = duration / spanCount;

    // Test performance and span generation
    const stats = tracer.getStats();
    expect(stats.spansGenerated).toBe(spanCount);
    expect(perSpan).toBeLessThan(0.01); // Should be under 0.01ms per span

    // Test that we can create and serialize a payload
    const payload = tracer.createPayload();
    const serialized = JSON.stringify(payload);
    expect(serialized.length).toBeGreaterThan(0);

    // Test that payload structure is correct
    expect(payload.resourceSpans).toHaveLength(1);
    expect(payload.resourceSpans[0].scopeSpans[0].spans.length).toBeGreaterThan(
      0,
    );
  });

  test("should debug batching behavior", () => {
    const tracer = new Tracer("batch-debug", {
      endpoint: "http://localhost:4318/v1/traces",
      maxBufferSize: 10,
      maxBatchSize: 10,
      flushIntervalMs: 60000,
      networkEnabled: false,
    });

    // Create 5 spans
    for (let i = 0; i < 5; i++) {
      const span = tracer.startSpan(`test-${i}`);
      tracer.endSpan(span);
      expect(tracer.getStats().spansGenerated).toBe(i + 1);
    }

    const payload = tracer.createPayload();
    expect(payload.resourceSpans[0].scopeSpans[0].spans.length).toBe(5);
  });

  test("should handle networkEnabled option", async () => {
    // Test with networking disabled
    const tracerDisabled = new Tracer("network-disabled-test", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: false,
      maxBatchSize: 1, // Small batch size to trigger immediate flush
    });

    const span = tracerDisabled.startSpan("test-operation");
    tracerDisabled.endSpan(span);

    // Should not attempt network request
    await tracerDisabled.send();

    const stats = tracerDisabled.getStats();
    expect(stats.spansGenerated).toBe(1);
    expect(stats.spansSent).toBe(1); // Should be marked as sent but not actually sent
    expect(stats.batchesSent).toBe(0); // No actual network batches sent
    expect(stats.batchesFailed).toBe(0);

    // Test with networking enabled - create spans but don't send
    const tracerEnabled = new Tracer("network-enabled-test", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: true,
      maxBatchSize: 100, // Large batch size to prevent auto-flush
    });

    const span2 = tracerEnabled.startSpan("test-operation");
    tracerEnabled.endSpan(span2);

    const stats2 = tracerEnabled.getStats();
    expect(stats2.spansGenerated).toBe(1);
    expect(stats2.spansBuffered).toBe(1); // Should be buffered waiting for network
    expect(stats2.spansSent).toBe(0); // Not sent yet
  });

  test("should produce OTLP-compliant output", () => {
    const tracer = new Tracer("otlp-test-service", {
      endpoint: "http://localhost:4318/v1/traces",
      networkEnabled: false,
    });

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
      name: "tracer",
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
