import { DayLayout } from "./layout";

function optimalWorkerCount() {
  const min = 2;
  const max = 8;
  const cpuCount = navigator.hardwareConcurrency || 4;
  let workerCount = Math.floor(cpuCount * 0.75);
  workerCount = Math.max(min, workerCount);
  workerCount = Math.min(max, workerCount);
  return workerCount;
}

export class CacheEntry<T> {
  data: T;
  fresh: boolean = true;
  constructor(data: T) {
    this.data = data;
  }
}

type UIEvent = any;

// Batches UI events & manages workers
// The goal being to render a day, region & or layout when a change occurs
export class Orchestrator {
  events: UIEvent[] = []; // Event queue
  workers: Worker[] = [];
  layoutCache = new Map<number, CacheEntry<DayLayout>>();
  tileCache = new Map<number, CacheEntry<ImageBitmap[]>>(); // TODO: Calculate if tile will be affected in advance, or simply day level at first?
  // TODO: Keep track of cache freshness per worker to avoid passing back and forth same cache (could go in CacheEntry)
  constructor() {}
  createWorkerPool() {
    const count = optimalWorkerCount();
    for (let i = 0; i < count; i++) {
      const worker = new Worker(
        new URL("./worker.ts?worker", import.meta.url),
        {
          type: "module",
        },
      );
      worker.addEventListener("error", (error) => {
        console.error("Worker error:", error);
      });
      this.workers.push(worker);
    }
  }
  addEvent(event: UIEvent) {
    this.events.push(event);
  }
  batchProcess(limit = 1000) {
    // The goal here is to look at en event and see if it invalidates a cache - but for rendering - potentially limits the y extents of the change
    // We can look for changes in the viewport
    // Event changes - affects layout for entire day(s) in viewport
    // Clipspace change - new days in clipspace - may require layout or render if nothing in cache
    // View parameters change - in general, rerender only (but layout required if time px changes)
    // Selected items - layout stays - however z-index changes, so render code must change
    // Updates processed by day a time
  }
  processMessage() {
    // Processes incoming message (comprising layouts and or tiles)
  }
  processTiles() {
    // Caches latest tiles
  }
  processLayout() {
    // Caches new layouts
  }
}
