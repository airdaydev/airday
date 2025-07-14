// @ts-ignore
import { test, expect } from "bun:test";

// Integrated OTLP testing
import { ULSpan, ULTracer } from "../src/index";

test("simple span", async () => {
  const tracer = new ULTracer("otlp-tester");
  const span = tracer.startSpan("yo");
  tracer.endSpan(span);
  console.log("sending spans to date");
  await tracer.send("http://localhost:4318/v1/traces");
});

test("complex spans with nested operations", async () => {
  const tracer = new ULTracer("otlp-complex-tester");

  // Create a more complex span with nested operations
  const rootSpan = tracer.startSpan("complex-operation");
  tracer.addTag(rootSpan, "operation.type", "batch-processing");
  tracer.addTag(rootSpan, "batch.size", 100);
  tracer.addTag(rootSpan, "environment", "test");

  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 5));

  // Add a nested span
  const childSpan = tracer.startSpan("database-query", rootSpan.spanId);
  tracer.addTag(childSpan, "db.table", "users");
  tracer.addTag(childSpan, "db.operation", "SELECT");
  tracer.log(childSpan, "Query executed", { rowCount: 42, duration: "12ms" });

  await new Promise((resolve) => setTimeout(resolve, 10));

  // Another nested span
  const processSpan = tracer.startSpan("data-processing", rootSpan.spanId);
  tracer.addTag(processSpan, "processor.type", "json-transformer");
  tracer.addTag(processSpan, "items.processed", 42);
  tracer.log(processSpan, "Processing started");

  await new Promise((resolve) => setTimeout(resolve, 8));

  // Add some events
  tracer.log(rootSpan, "Checkpoint reached", { progress: 0.5 });
  tracer.log(processSpan, "Processing completed", { success: true });

  // End spans
  tracer.endSpan(processSpan);
  tracer.endSpan(childSpan);
  tracer.endSpan(rootSpan);

  console.log("Sending complex spans");
  await tracer.send("http://localhost:4318/v1/traces");
});

test("performance test - 1000 spans", async () => {
  console.log("█▒ Performance tests start");

  const tracer = new ULTracer("otlp-perf-tester");
  const startTime = performance.now();

  // Generate 1000 spans with varying complexity
  for (let i = 0; i < 1000; i++) {
    const span = tracer.startSpan(`operation-${i}`);

    // Add attributes
    tracer.addTag(span, "iteration", i);
    tracer.addTag(span, "batch", Math.floor(i / 100));
    tracer.addTag(
      span,
      "operation.type",
      i % 3 === 0 ? "read" : i % 3 === 1 ? "write" : "compute",
    );
    tracer.addTag(span, "priority", i % 10 < 3 ? "high" : "normal");

    // Add some events for every 10th span
    if (i % 10 === 0) {
      tracer.log(span, "Processing started", { itemId: i });
      tracer.log(span, "Validation passed", { checks: 5 });
    }

    // Add error status for every 50th span
    if (i % 50 === 0 && i > 0) {
      tracer.addTag(span, "error", true);
      tracer.addTag(span, "error.message", `Simulated error at iteration ${i}`);
      (span as any).status = { code: 2, message: `Error ${i}` };
    }

    // Simulate some work with micro-delay every 100th span
    if (i % 100 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    tracer.endSpan(span);
  }

  const generationTime = performance.now() - startTime;
  console.log(`Generated 1000 spans in ${generationTime.toFixed(2)}ms`);

  // Test payload creation performance
  const payloadStartTime = performance.now();
  const payload = tracer.createPayload();
  const payloadTime = performance.now() - payloadStartTime;
  console.log(`Created OTLP payload in ${payloadTime.toFixed(2)}ms`);

  // Test serialization performance
  const serializationStartTime = performance.now();
  const serialized = JSON.stringify(payload);
  const serializationTime = performance.now() - serializationStartTime;
  console.log(
    `Serialized payload (${(serialized.length / 1024).toFixed(2)}KB) in ${serializationTime.toFixed(2)}ms`,
  );

  // Test network send performance
  const sendStartTime = performance.now();
  await tracer.send("http://localhost:4318/v1/traces");
  const sendTime = performance.now() - sendStartTime;
  console.log(`Sent payload over network in ${sendTime.toFixed(2)}ms`);

  const totalTime = performance.now() - startTime;
  console.log(`Total end-to-end time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per span: ${(totalTime / 1000).toFixed(4)}ms`);
  console.log(
    `Throughput: ${(1000 / (totalTime / 1000)).toFixed(0)} spans/second`,
  );

  // Assertions
  expect(generationTime).toBeLessThan(100); // Should generate 1000 spans in < 100ms
  expect(payloadTime).toBeLessThan(50); // Should create payload in < 50ms
  expect(serializationTime).toBeLessThan(50); // Should serialize in < 50ms
  expect(totalTime).toBeLessThan(1000); // Total should be < 1s

  console.log("█▒ Performance tests completed");
});

test("batching system test", async () => {
  console.log("█▒ Batch sys tests");

  // Test with smaller batch size for quick testing
  const tracer = new ULTracer("batching-tester", {
    maxBatchSize: 5,
    flushIntervalMs: 2000, // 2 second flush interval
    endpoint: "http://localhost:4318/v1/traces",
  });

  // Create spans one by one to test batching
  const spans: ULSpan[] = [];
  for (let i = 0; i < 12; i++) {
    const span = tracer.startSpan(`batch-test-${i}`);
    tracer.addTag(span, "test.iteration", i);
    tracer.addTag(span, "test.batch", Math.floor(i / 5));

    if (i === 3) {
      tracer.log(span, "Midpoint reached", { progress: 0.25 });
    }

    spans.push(span);

    // Add small delay to simulate real work
    await new Promise((resolve) => setTimeout(resolve, 10));

    tracer.endSpan(span);

    // Check stats after every few spans
    if (i % 3 === 0) {
      const stats = tracer.getStats();
      expect(stats.spansGenerated).toBe(i + 1);
    }
  }

  console.log("Ensuring time-based flush...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const finalStats = tracer.getStats();
  expect(finalStats.spansGenerated).toBe(12);
  expect(finalStats.batchesSent).toBeGreaterThan(0);
  expect(finalStats.spansSent).toBe(12);
  expect(finalStats.spansBuffered).toBe(0); // Should be empty after flush
  console.log("█▒ Batch testing complete");
});

test("buffer overflow test", async () => {
  // Test with very small buffer to trigger overflow
  const tracer = new ULTracer("overflow-tester", {
    maxBatchSize: 1000, // Large batch size
    maxBufferSize: 10, // Small buffer
    flushIntervalMs: 60000, // Long flush interval
    endpoint: "http://localhost:4318/v1/traces",
  });

  // Create more spans than buffer can hold
  for (let i = 0; i < 15; i++) {
    const span = tracer.startSpan(`overflow-test-${i}`);
    tracer.addTag(span, "test.overflow", true);
    tracer.endSpan(span);
  }

  const stats = tracer.getStats();

  // Verify overflow behavior
  expect(stats.spansGenerated).toBe(15);
  expect(stats.spansBuffered).toBe(10); // Should be at max buffer size
  expect(stats.spansDropped).toBe(5); // Should have dropped 5 spans
});
