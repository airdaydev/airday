import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
import { localZeroDate } from "../time";
import { DayLayout } from "./layout";
import { CacheEntry } from "../utils/cache";
import { appendDayLayout, DayEl } from "./dom";

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
  allDayRendered = false;
  allDayCache = new CacheEntry<Map<number, Set<CalendarEvent>>>(new Map());
  allDayIdCache = new CacheEntry<Map<string, CalendarEvent>>(new Map());
  dataCache = new Map<number, CacheEntry<Map<string, CalendarEvent>>>();
  layoutCache = new Map<number, CacheEntry<DayLayout>>();
  domCache = new Map<number, CacheEntry<HTMLDivElement>>(); // has the thing rendered or nah, also TODO: we need to clean up anything outside current vals!
  renderedCache = new Map<number, CacheEntry<boolean>>();
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
      cache.data.style.transform = `translate(${x}px)`;
      cache.data.style.width = `${this.airdayCal.transform.dayPx}px`;
    }
  }
  // Designed to be run on an animation frame ticks, figures out which days are dirty, starting with the assumption that none are
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

    // Setup containers
    for (let date of this.airdayCal.transform.dates) {
      const dateVal = date.valueOf();
      const domPx = this.airdayCal.transform.dateToX(date.valueOf());
      if (!this.domCache.get(dateVal)) {
        const dayEl = DayEl(this.airdayCal, dateVal, domPx);
        this.airdayCal.eventsContainer.appendChild(dayEl); // TODO: append at once
        this.domCache.set(dateVal, new CacheEntry(dayEl));
      }
    }
    // TODO: Start with internal regions, then buffer.
    // TODO: Consider cleaning up a little bit
    for (let date of this.airdayCal.transform.dates) {
      const dateVal = date.valueOf();
      const data = this.dataCache.get(dateVal);
      if (!data || !data.fresh) {
        const localZero = localZeroDate(date);
        const events = this.airdayCal.db.getEvents(
          localZero,
          new Date(localZero.valueOf() + 864e5),
        );
        const eventIdMap = new Map<string, CalendarEvent>();
        events.forEach((event) => {
          eventIdMap.set(event.id, event);
        });
        const shortTermEvents = events.filter((event) => {
          if (
            event.end.valueOf() - event.start.valueOf() >=
            24 * 60 * 60 * 1000
          ) {
            this.allDayIdCache.data.set(event.id, event);
            const day = this.allDayCache.data.get(dateVal);
            if (day) {
              day.add(event);
            } else {
              this.allDayCache.data.set(dateVal, new Set([event]));
            }
            this.allDayRendered = false;
            return false;
          }
          return true;
        });
        this.dataCache.set(dateVal, new CacheEntry(eventIdMap));
        // TODO: Separate function & compress further
        const transfer = [];
        eventIdMap.forEach((event) => {
          transfer.push({
            id: event.id,
            start: event.start,
            end: event.end,
          });
        });
        if (shortTermEvents) {
          this.assignWork({
            type: "next",
            date,
            events: shortTermEvents.map((e) => e.transfer()),
            theme: this.airdayCal.theme,
            transform: [
              this.airdayCal.transform.dayPx,
              this.airdayCal.transform.hourPx,
            ],
          });
          continue;
        }
      }
      const layout = this.layoutCache.get(dateVal);
      // if no layout?
      const idData = this.dataCache.get(dateVal);
      const domData = this.domCache.get(dateVal);
      const rendered = this.renderedCache.get(dateVal);
      if (
        (!rendered || !rendered.data) &&
        domData &&
        layout &&
        layout.data &&
        idData
      ) {
        appendDayLayout(
          domData.data.getElementsByClassName("day-events")[0] as HTMLElement, // TODO: eh enumeration/text match look up...
          layout.data,
          idData.data,
        );
        this.renderedCache.set(dateVal, new CacheEntry(true));
      }
    }
    const minDate = this.airdayCal.transform.dates[0].valueOf();
    const maxDate =
      this.airdayCal.transform.dates[
        this.airdayCal.transform.dates.length - 1
      ].valueOf();
    this.domCache.forEach((cache) => {
      const date = Number(cache.data.getAttribute("data-date"));
      if (date < minDate) {
        cache.data.parentNode?.removeChild(cache.data);
        this.domCache.delete(date);
        this.renderedCache.delete(date);
      }
      if (date > maxDate) {
        cache.data.parentNode?.removeChild(cache.data);
        this.domCache.delete(date);
        this.renderedCache.delete(date);
      }
    });
    if (!this.allDayRendered && this.airdayCal.allDayEvents) {
      this.airdayCal.allDayEvents.render(
        this.allDayCache.data,
        this.allDayIdCache.data,
      );
      this.allDayRendered = true;
    }
    // if (this.airdayCal.allDayEvents) {
    //   console.log("allDayEvents");
    // }
  }
  processMessage(message: any) {
    // Processes incoming message (comprising layouts and or bitmaps)
    const data = message.data;
    if (data.layout) {
      this.layoutCache.set(data.date.valueOf(), new CacheEntry(data.layout));
    }
    this.startWorkQueue();
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
