import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
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

interface workloadOpts {
  utcDay: number;
  layout: boolean;
  bitmap: boolean;
  // TODO: Tile/region
}

export class UIWorker {
  id: number;
  worker: Worker;
  busy: boolean = false;
  coordinator: EventRenderCoordinator;
  constructor(coordinator: EventRenderCoordinator) {
    this.worker = new Worker(new URL("./worker.ts?worker", import.meta.url), {
      type: "module",
    });
    this.worker.addEventListener("error", (error) => {
      console.error("Worker error:", error);
    });
    this.coordinator = coordinator;
  }
  send(opts: workloadOpts) {
    if (this.busy) {
      console.warn("Worker busy, cannot complete work");
      return;
    }
    this.busy = true;
  }
  receive(workload: any) {
    this.busy = false;
    this.coordinator.workComplete(this.id);
  }
}

export class CacheEntry<T> {
  data: T;
  fresh: boolean = true;
  constructor(data: T) {
    this.data = data;
  }
  markStale() {
    this.fresh = false;
  }
}

interface UIEvent {
  type: "data" | "layout" | "bitmap";
  utcDay: number;
}

// Processes UI events, manages workers, caches layouts and bitmaps
// TODO: Break days down into tiles
export class EventRenderCoordinator {
  airdayCal: AirdayCal;
  events: UIEvent[] = []; // Event queue
  workers: UIWorker[] = [];
  dataCache = new Map<number, CacheEntry<CalendarEvent>>();
  layoutCache = new Map<number, CacheEntry<DayLayout>>();
  bitmapCache = new Map<number, CacheEntry<ImageBitmap>>();
  // TODO: Keep track of cache data (layout, event) freshness per worker to avoid passing back and forth same cache (could go in CacheEntry)
  constructor(airdayCal: AirdayCal) {
    this.airdayCal = airdayCal;
  }
  createWorkerPool() {
    const count = optimalWorkerCount();
    for (let i = 0; i < count; i++) {
      this.workers.push(new UIWorker(this));
    }
  }
  addEvent(event: UIEvent) {
    this.events.push(event);
  }
  // Designed to be run on an animation frame ticks, figures out which days are dirty, starting with the assumption that none are
  // TODO: May need to vary event processing time based on actual render time (TODO: Measure with performance.mark)
  // TODO: Calculate affected tiles (?)
  tick(maxMs = 16) {
    // Process events
    const start = performance.now();
    while (this.events.length > 0) {
      if (performance.now() - start > maxMs) break;
      const event = this.events.shift() as UIEvent;
      switch (event.type) {
        case "data":
          this.dataCache.get(event.utcDay)?.markStale();
          this.layoutCache.get(event.utcDay)?.markStale();
          this.bitmapCache.get(event.utcDay)?.markStale();
          break;
        case "layout":
          // mostly viewport changes (due to changing time height for example)
          this.layoutCache.get(event.utcDay)?.markStale();
          this.bitmapCache.get(event.utcDay)?.markStale();
          break;
        case "bitmap":
          // e.g. selecting events
          this.bitmapCache.get(event.utcDay)?.markStale();
          break;
        default:
      }
    }
    // From utc date range (start in the middle and fanning out), find stale dates & assign work to all workers
    // TODO: Consider too - assigning some work to main thread (but how to prioritise?)
  }
  processMessage() {
    // Processes incoming message (comprising layouts and or bitmaps)
  }
  processBitmaps() {
    // Caches latest bitmaps
  }
  processLayout() {
    // Caches new layouts
  }
  assignWork(work: Workload[]) {
    for (let worker of this.workers) {
      if (worker.busy) return;
      worker.send(work);
    }
  }
}
