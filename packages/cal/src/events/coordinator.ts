import { Rectangle } from "@timohausmann/quadtree-ts";
import { AirdayCal } from "../cal";
import { Rect, scale } from "../canvas";
import { CalendarEvent } from "../model";
import { localZeroDate, utcZeroDate } from "../time";
import { DayLayout } from "./layout";
import { EventUIData } from "../ui-objects";
import { renderDay } from "./render";

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
  constructor(id: number, coordinator: EventRenderCoordinator) {
    this.coordinator = coordinator;
    this.id = id;
    this.worker = new Worker(
      new URL("./worker-instance.ts?worker", import.meta.url),
      {
        type: "module",
      },
    );
    this.worker.addEventListener("error", (error) => {
      console.error("Worker error:", error);
    });
    this.worker.addEventListener("message", (message) => this.receive(message));
  }
  send(workload: Workload) {
    if (this.busy) {
      console.warn("Worker busy, cannot complete work");
      return;
    }
    this.busy = true;
    this.worker.postMessage(workload);
  }
  receive(message: any) {
    this.busy = false;
    this.coordinator.processMessage(message);
  }
}

export class CacheEntry<T> {
  data: T;
  fresh: boolean = true;
  pending = false;
  constructor(data: T) {
    this.data = data;
  }
  markStale() {
    this.fresh = false;
  }
  markPending() {
    this.pending = true;
  }
}

interface UIEvent {
  type: "data" | "layout" | "bitmap";
  utcDay: number;
}

interface Workload {
  utcDate: number;
}

// Processes UI events, manages workers, caches layouts and bitmaps
// TODO: Break days down into tiles
export class EventRenderCoordinator {
  airdayCal: AirdayCal;
  events: UIEvent[] = []; // Event queue
  workers: UIWorker[] = [];
  dataCache = new Map<number, CacheEntry<CalendarEvent[]>>();
  layoutCache = new Map<number, CacheEntry<DayLayout>>();
  bitmapCache = new Map<number, CacheEntry<ImageBitmap>>();
  // TODO: Keep track of cache data (layout, event) freshness per worker to avoid passing back and forth same cache (could go in CacheEntry)
  constructor(airdayCal: AirdayCal) {
    this.airdayCal = airdayCal;
    this.createWorkerPool();
  }
  createWorkerPool() {
    const count = optimalWorkerCount();
    for (let i = 0; i < count; i++) {
      this.workers.push(new UIWorker(i, this));
    }
  }
  addEvent(event: UIEvent) {
    this.events.push(event);
  }
  clearBitmapCache() {
    this.bitmapCache.forEach((val, key) => {
      console.log("yooo", val);
      val.markStale();
    });
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
    // TODO: Start with internal regions, then buffer.
    for (let date of this.airdayCal.transform.dates) {
      const dateVal = date.valueOf();
      const data = this.dataCache.get(dateVal);
      if (!data || !data.fresh) {
        const localZero = localZeroDate(date);
        const events = this.airdayCal.db.getEvents(
          localZero,
          new Date(localZero.valueOf() + 864e5),
        );
        this.dataCache.set(dateVal, new CacheEntry(events));
        const assigned = this.assignWork({
          type: "next",
          date,
          events: events.map((e) => e.transfer()),
          theme: this.airdayCal.theme,
          transform: [
            this.airdayCal.transform.dayPx,
            this.airdayCal.transform.hourPx,
            scale(),
          ],
        });
        // TODO: Slightly ugly, but basically this means a bitmap is incoming so skip it
        // Without this, we could potentially ask for a bitmap 2x over successive ticks, as one would be incoming without a cache entry
        if (assigned) {
          const bitmapCache = this.bitmapCache.get(dateVal);
          if (bitmapCache) {
            bitmapCache.markPending();
          }
        }
        return;
      }
      // TODO: Important possible issue! We need to let our workers know coordinate know that we are ALREADY fetching dates
      // TODO: Layout!
      const bitmap = this.bitmapCache.get(dateVal);
      if (!bitmap || (bitmap && bitmap.pending) || !bitmap.fresh) {
        if (bitmap) bitmap.markPending();
        const events = this.dataCache.get(dateVal);
        if (!events || !events.data) return; // However, this means we want a blank bitmap!
        // TODO: We may already have layout though!
        this.assignWork({
          type: "next",
          date,
          events: events.data.map((e) => e.transfer()),
          theme: this.airdayCal.theme,
          transform: [
            this.airdayCal.transform.dayPx,
            this.airdayCal.transform.hourPx,
            scale(),
          ],
        });
      }
      // TODO: Same with layout, bitmap
    }
    // this.airdayCal
    // TODO: Consider too - assigning some work to main thread (but how to prioritise?)
  }
  processMessage(message: any) {
    // Processes incoming message (comprising layouts and or bitmaps)
    const data = message.data;
    if (data.bitmap) {
      this.bitmapCache.set(data.date.valueOf(), new CacheEntry(data.bitmap));
    }
    if (data.layout) {
      this.layoutCache.set(data.date.valueOf(), new CacheEntry(data.layout));
      const objs: Rectangle<EventUIData>[] = [];
      for (let [id, event] of data.layout.map.entries()) {
        objs.push(
          new Rectangle<EventUIData>({
            x: event.x,
            width: event.width,
            y: event.y,
            height: event.height,
            data: {
              type: 0,
              id,
              z: event.segment,
            },
          }),
        );
      }
      this.airdayCal.uiObjects.updateDay(data.date.valueOf(), objs);
    }
  }
  assignWork(work: Workload[]) {
    for (let worker of this.workers) {
      if (worker.busy) continue;
      worker.send(work);
      return true;
    }
    this.airdayCal.act(); // There's still work left! (TODO: This is imperfect - try to pan across with 100 days viewing)
    return false;
  }
  // For immediate updates only!
  mainThreadRender() {}
  async renderRegion(
    date: number,
    region: Rect,
    offset?: [number, number],
    highlightId?: string,
    ts?: number,
  ) {
    const zeroDate = utcZeroDate(new Date(date)).valueOf(); // TODO: Necessary?
    const layout = this.layoutCache.get(zeroDate);
    if (!layout) {
      console.warn(`Cant rerender layout region ${date}`);
      return;
    }
    // TODO: Set canvas x/y
    renderDay(this.airdayCal.ctx2D, layout.data, date, {
      theme: this.airdayCal.theme,
      region,
      offset,
      highlightId,
      fadeTs: ts,
    });
  }
}
