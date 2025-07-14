// NOTE: This file has been vibecoded and remains unchecked in-depth

interface SpanLog {
  timestamp: number;
  message: string;
  data?: Record<string, any>;
}

// Minimal types for compatibility
type ULTime = [number, number]; // seconds, nanoseconds
type Attributes = Record<string, any>;

interface ULSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startTime: ULTime;
  readonly endTime: ULTime;
  readonly duration: ULTime;
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

interface BatchConfig {
  maxBatchSize: number; // Default: 50 (smaller for browser)
  flushIntervalMs: number; // Default: 10000ms (10s - less aggressive)
  endpoint: string; // OTLP endpoint
  maxBufferSize: number; // Default: 2500 spans
  maxRetries: number; // Default: 2 (less aggressive)
  retryDelayMs: number; // Default: 2000ms
  useBeacon: boolean; // Default: true (for page unload)
  pauseWhenHidden: boolean; // Default: true (save battery)
  networkEnabled: boolean; // Default: true (enable networking)
}

interface TracerStats {
  spansGenerated: number; // Total spans created
  spansBuffered: number; // Currently in buffer
  spansSent: number; // Successfully sent
  spansDropped: number; // Dropped due to buffer overflow
  batchesSent: number; // Total batches sent
  batchesFailed: number; // Failed batch attempts
  lastSendTime: number; // Timestamp of last successful send
  lastError: string | null; // Last error message
}

interface LiveStats {
  isOnline: boolean; // Network status
  isTabVisible: boolean; // Tab visibility
  beaconSupported: boolean; // Beacon API support
}

// Ultra-light JSON tracer
export class ULTracer {
  private serviceName: string;
  private spans: ULSpan[] = [];
  private resource: { attributes: Attributes };
  private readonly epochOffsetMs = Date.now() - performance.now();

  // Batching system
  private batchConfig: BatchConfig;
  private batchTimer: number | null = null;
  private retryCount = 0;
  private circuitBreakerUntil = 0;
  private isTabVisible = true;
  private isOnline = true;
  private beaconSupported: boolean; // Beacon API support

  // Stats
  private stats: TracerStats = {
    spansGenerated: 0,
    spansBuffered: 0,
    spansSent: 0,
    spansDropped: 0,
    batchesSent: 0,
    batchesFailed: 0,
    lastSendTime: 0,
    lastError: null,
  };

  constructor(serviceName: string, config: Partial<BatchConfig> = {}) {
    if (!serviceName) {
      throw new Error("ULTracer: serviceName required");
    }
    this.serviceName = serviceName;
    this.resource = { attributes: { "service.name": serviceName } };

    // Set default batch config
    this.batchConfig = {
      maxBatchSize: 50,
      flushIntervalMs: 10000,
      endpoint: "http://localhost:4318/v1/traces",
      maxBufferSize: 2500,
      maxRetries: 2,
      retryDelayMs: 2000,
      useBeacon: true,
      pauseWhenHidden: true,
      networkEnabled: true,
      ...config,
    };

    this.initializeBrowserFeatures();
    this.startBatching();
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

    this.addSpanToBuffer(span);
    this.stats.spansGenerated++;
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

    // Check if we should flush based on batch size
    this.checkBatchSize();

    return span;
  }

  addTag(span: ULSpan, key: string, value: any): void {
    (span.attributes as any)[key] = value;
  }

  log(span: ULSpan, message: string, data: Record<string, any> = {}): void {
    const event: SpanLog = {
      timestamp: this.epochOffsetMs + performance.now(),
      message,
      data,
    };
    (span.events as any).push(event);
  }

  flush(): ULSpan[] {
    const traces = this.spans.slice();
    this.spans = [];
    this.updateStats();
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

  async send(endpoint?: string): Promise<void> {
    return this.flushNow(endpoint);
  }

  getStats(): TracerStats & LiveStats {
    this.updateStats();
    return {
      ...this.stats,
      isOnline: this.isOnline,
      isTabVisible: this.isTabVisible,
      beaconSupported: this.beaconSupported,
    };
  }

  async flushNow(endpoint?: string): Promise<void> {
    if (this.spans.length === 0) return;

    const targetEndpoint = endpoint || this.batchConfig.endpoint;
    const payload = this.createPayload();

    // If networking is disabled, just clear the spans without sending
    if (!this.batchConfig.networkEnabled) {
      this.stats.spansSent +=
        payload.resourceSpans[0]?.scopeSpans[0]?.spans.length || 0;
      return;
    }

    try {
      await this.sendBatch(payload, targetEndpoint);
      this.stats.batchesSent++;
      this.stats.lastSendTime = Date.now();
      this.retryCount = 0;
      this.circuitBreakerUntil = 0;
    } catch (error) {
      this.stats.batchesFailed++;
      this.stats.lastError = String(error);
      this.handleSendError(error);
    }
  }

  private initializeBrowserFeatures(): void {
    if (typeof window === "undefined") return;

    // Check for beacon support
    this.beaconSupported =
      typeof navigator !== "undefined" && "sendBeacon" in navigator;

    // Online/offline detection
    if (typeof navigator !== "undefined") {
      this.isOnline = navigator.onLine;

      window.addEventListener("online", () => {
        this.isOnline = true;
        this.circuitBreakerUntil = 0; // Reset circuit breaker
      });

      window.addEventListener("offline", () => {
        this.isOnline = false;
      });
    }

    if (typeof document !== "undefined") {
      this.isTabVisible = document.visibilityState === "visible";

      document.addEventListener("visibilitychange", () => {
        this.isTabVisible = document.visibilityState === "visible";

        if (!this.isTabVisible) {
          this.flushNow().catch(console.error);
        }
      });
    }

    if (typeof window !== "undefined") {
      const flushOnUnload = () => {
        if (this.spans.length > 0) {
          this.sendBeacon();
        }
      };

      window.addEventListener("beforeunload", flushOnUnload);
      window.addEventListener("pagehide", flushOnUnload);
    }
  }

  private startBatching(): void {
    if (this.batchTimer) return;

    this.batchTimer = setInterval(() => {
      if (this.shouldFlush()) {
        this.flushNow().catch(console.error);
      }
    }, this.batchConfig.flushIntervalMs) as any;
  }

  private addSpanToBuffer(span: ULSpan): void {
    // Check if buffer is full
    if (this.spans.length >= this.batchConfig.maxBufferSize) {
      // Drop oldest span (FIFO)
      this.spans.shift();
      this.stats.spansDropped++;
    }

    this.spans.push(span);
    this.updateStats();
  }

  private checkBatchSize(): void {
    if (this.spans.length >= this.batchConfig.maxBatchSize) {
      this.flushNow().catch(console.error);
    }
  }

  private shouldFlush(): boolean {
    if (this.spans.length === 0) return false;
    if (!this.batchConfig.networkEnabled) return false;
    if (!this.isOnline) return false;
    if (this.batchConfig.pauseWhenHidden && !this.isTabVisible) return false;
    if (Date.now() < this.circuitBreakerUntil) return false;

    return true;
  }

  // Send batch with retry logic
  private async sendBatch(
    payload: TracePayload,
    endpoint: string,
  ): Promise<void> {
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

      this.stats.spansSent +=
        payload.resourceSpans[0]?.scopeSpans[0]?.spans.length || 0;
    } catch (error) {
      this.retryCount++;

      if (this.retryCount <= this.batchConfig.maxRetries) {
        // Exponential backoff
        const delay =
          this.batchConfig.retryDelayMs * Math.pow(2, this.retryCount - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendBatch(payload, endpoint);
      }

      // Circuit breaker: stop trying for 30 seconds
      this.circuitBreakerUntil = Date.now() + 30000;
      throw error;
    }
  }

  // Send using beacon API for page unload
  private sendBeacon(): void {
    if (!this.beaconSupported || this.spans.length === 0) return;
    if (!this.batchConfig.networkEnabled) return;

    try {
      const payload = this.createPayload();
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      navigator.sendBeacon(this.batchConfig.endpoint, blob);
      this.stats.spansSent += this.spans.length;
      this.spans = [];
    } catch (error) {
      console.error("ULTracer: Failed to send beacon:", error);
    }
  }

  // Handle send errors
  private handleSendError(error: any): void {
    // TODO: Generate span?
    console.error("ULTracer: Batch send failed:", error);
    // Spans remain in buffer for retry
  }

  // Update stats
  private updateStats(): void {
    this.stats.spansBuffered = this.spans.length;
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

  // Convert ULTime to nanoseconds
  private hrTimeToNanos(hrTime: ULTime): bigint {
    const [seconds, nanos] = hrTime;
    return BigInt(seconds) * BigInt(1000000000) + BigInt(Math.floor(nanos));
  }

  // Utility methods
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private hrTime(): ULTime {
    const absoluteMs = this.epochOffsetMs + performance.now();
    const seconds = Math.floor(absoluteMs / 1000);
    const nanoseconds = Math.floor((absoluteMs % 1000) * 1000000);
    return [seconds, nanoseconds];
  }

  private calculateDuration(start: ULTime, end: ULTime): ULTime {
    const startMs = start[0] * 1000 + start[1] / 1000000;
    const endMs = end[0] * 1000 + end[1] / 1000000;
    const durationMs = endMs - startMs;
    return [Math.floor(durationMs / 1000), (durationMs % 1000) * 1000000];
  }
}

export {
  type ULSpan,
  type SpanLog,
  type TracePayload,
  type BatchConfig,
  type TracerStats,
};
