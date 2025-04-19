import { Rectangle } from "@timohausmann/quadtree-ts";
import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
import { localZeroDate } from "../time";
import { DayLayout } from "./layout";
import { EventUIData } from "../ui-objects";
import { CacheEntry } from "../utils/cache";
import { DayEl } from "./dom";

function optimalWorkerCount() {
  const min = 2;
  const max = 8;
  const cpuCount = navigator.hardwareConcurrency || 4;
  let workerCount = Math.floor(cpuCount * 0.75);
  workerCount = Math.max(min, workerCount);
  workerCount = Math.min(max, workerCount);
  return workerCount;
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
    this.coordinator.idleWorkers.add(this);
  }
  send(workload: Workload) {
    if (this.busy) {
      console.warn("Worker busy, cannot complete work");
      return;
    }
    this.busy = true;
    this.coordinator.idleWorkers.delete(this);
    this.worker.postMessage(workload);
  }
  receive(message: any) {
    this.busy = false;
    this.coordinator.idleWorkers.add(this);
    this.coordinator.processMessage(message);
  }
}

interface UIEvent {
  type: "data" | "layout";
  utcDay: number;
}

interface Workload {
  date: Date;
  type: string;
  utcDate?: number;
  events: any;
  theme: any;
  transform: any;
}

// Processes UI events, manages workers, caches layouts
// TODO: Break days down into tiles
export class EventRenderCoordinator {
  airdayCal: AirdayCal;
  events: UIEvent[] = []; // Event queue
  workers: UIWorker[] = [];
  idleWorkers: Set<UIWorker> = new Set();
  work: Workload[] = [];
  queueRunning = false;
  dataCache = new Map<number, CacheEntry<CalendarEvent[]>>();
  layoutCache = new Map<number, CacheEntry<DayLayout>>();
  domCache = new Map<number, CacheEntry<HTMLDivElement>>(); // has the thing rendered or nah, also TODO: we need to clean up anything outside current vals!
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
  resize() {
    for (let entry of this.domCache.entries()) {
      const [date, cache] = entry;
      const x = this.airdayCal.transform.dateToX(date);
      // console.log("changing", new Date(date), `translate(${x}px)`, cache.data);
      // 1. get new x val from date
      cache.data.style.transform = `translate(${x}px)`;
      cache.data.style.width = `${this.airdayCal.transform.dayPx}px`;
      // 2. get new width from date
      // 3. update!
    }
  }
  // Designed to be run on an animation frame ticks, figures out which days are dirty, starting with the assumption that none are
  // TODO: May need to vary event processing time based on actual render time (TODO: Measure with performance.mark)
  // TODO: Calculate affected tiles (?)
  tick(maxMs = 16) {
    if (!this.airdayCal.db.ready) return;
    // Process events
    const start = performance.now();
    while (this.events.length > 0) {
      if (performance.now() - start > maxMs) break;
      const event = this.events.shift() as UIEvent;
      switch (event.type) {
        case "data":
          this.dataCache.get(event.utcDay)?.markStale();
          this.layoutCache.get(event.utcDay)?.markStale();
          this.domCache.get(event.utcDay)?.markStale();
          break;
        case "layout":
          // mostly viewport changes (due to changing time height for example)
          this.layoutCache.get(event.utcDay)?.markStale();
          this.domCache.get(event.utcDay)?.markStale();
          break;
        default:
      }
    }
    // TODO: Start with internal regions, then buffer.
    let i = 0;
    for (let date of this.airdayCal.transform.dates) {
      const domPx = this.airdayCal.transform.dateToX(date.valueOf());
      i++;
      const dateVal = date.valueOf();
      const data = this.dataCache.get(dateVal);
      if (!data || !data.fresh) {
        const localZero = localZeroDate(date);
        const events = this.airdayCal.db.getEvents(
          localZero,
          new Date(localZero.valueOf() + 864e5),
        );
        this.dataCache.set(dateVal, new CacheEntry(events));
        this.assignWork({
          type: "next",
          date,
          events: events.map((e) => e.transfer()),
          theme: this.airdayCal.theme,
          transform: [
            this.airdayCal.transform.dayPx,
            this.airdayCal.transform.hourPx,
          ],
        });
        return;
      }
      const layout = this.layoutCache.get(dateVal);
      // if no layout?
      const domData = this.domCache.get(dateVal);
      if ((!domData || !domData?.fresh) && layout && layout.data) {
        const dayEl = DayEl(this.airdayCal, dateVal, layout.data, domPx);
        // dayEl.innerText = date.toString();
        this.airdayCal.eventsContainer.appendChild(dayEl);
        this.domCache.set(dateVal, new CacheEntry(dayEl)); // TODO: Hold reference to day dom element
      }
    }
    // TODO: Cleanup domcache
  }
  processMessage(message: any) {
    // Processes incoming message (comprising layouts and or bitmaps)
    const data = message.data;
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
      // this.airdayCal.uiObjects.updateDay(data.date.valueOf(), objs);
    }
    this.airdayCal.act(); // TODO: A little blunt
  }
  startWorkQueue() {
    if (this.queueRunning) return;
    this.queueRunning = true;
    // TODO: We could stop the queue while all workers are busy
    while (this.work.length && this.idleWorkers.size) {
      for (let worker of this.idleWorkers) {
        if (worker.busy) continue;
        const work = this.work.shift();
        if (work) worker.send(work);
      }
    }
    this.queueRunning = false;
  }
  assignWork(work: Workload) {
    this.work.push(work);
    this.startWorkQueue();
  }
  // For immediate recalcs of layers
  mainThreadRender() {}
}
