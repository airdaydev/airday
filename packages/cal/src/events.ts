import { CalRenderer } from "./render";
import { CalendarEvent } from "./model";
import { EventDB } from "./state";
import { getCanvasContext, scale } from "./canvas";
import { DayRange, getStartOfDay } from "./time";

// EventRenderer runs in a webworker & handles retrieval, indexing & rendering of events
// It renders a day at a time, marking days as dirty as required
//
export class EventCache {
  renderer: CalRenderer;
  db: EventDB;
  map = new Map<number, Set<CalendarEvent>>();
  transformMap = new Map<string, { x: number; y: number }>();
  range: DayRange | null = null;
  arr: CalendarEvent[] = []; // temp array of all events
  constructor(renderer: CalRenderer, db: EventDB) {
    this.renderer = renderer;
    this.db = db;
  }
  private loadEvents(events: CalendarEvent[]) {
    if (!this.range) throw new Error("No range in loadEvents");
    this.renderer.eventRenderer.worker.postMessage({
      type: "load",
      events: events.map((e) => e.transfer()), // TODO: Date to number
      range: [this.range.start.valueOf(), this.range.end.valueOf()],
    });
    // events.forEach((event) => {
    //   this.transformMap.set(event.id, [
    //     this.renderer.transform.dateToX(event.start),
    //     this.renderer.transform.timeToY(event.start),
    //   ]);
    // });
  }
  updateRange(range: DayRange) {
    const lastRange = this.range;
    this.range = range;
    if (!lastRange) {
      const events = this.db.getEvents(range.start, range.end);
      // New range is completely outside
      this.loadEvents(events);
      return;
    }
    if (range.start.valueOf() < lastRange.start.valueOf()) {
      // Range is entirely to the left of existing
      const events = this.db.getEvents(range.start, range.end);
      this.loadEvents(events);
      return;
    }
    if (range.start.valueOf() > lastRange.end.valueOf()) {
      // Range is entirely to the right of existing
      const events = this.db.getEvents(range.start, range.end);
      this.loadEvents(events);
      return;
    }
    // Clear previous ranges
    if (range.start.valueOf() > lastRange.end.valueOf()) {
      // clear between
    }
    if (range.end.valueOf() < lastRange.end.valueOf()) {
      // clear between
    }
    // Load new ranges
    let newEvents = [];
    if (range.start.valueOf() < lastRange.end.valueOf()) {
      // range before
      newEvents.push(...this.db.getEvents(range.start, lastRange.start));
    }
    if (range.end.valueOf() > lastRange.end.valueOf()) {
      // range after
      newEvents.push(...this.db.getEvents(lastRange.end, range.end));
    }
    if (newEvents.length) {
      this.loadEvents(newEvents);
    }
  }
}

// Performance test: translate vs rerender
export class EventRenderer {
  calRenderer: CalRenderer;
  worker: Worker;
  map = new Map<number, ImageBitmap>();
  constructor(calRenderer: CalRenderer) {
    // get grid size from parent, must connect to resize event from parent
    this.calRenderer = calRenderer;
    this.worker = new Worker(new URL("./workers/events.ts", import.meta.url));
    this.worker.onerror = (error) => {
      console.error("Worker error:", error);
    };
    this.worker.addEventListener("message", (event) => {
      if (event.data.type === "frame") {
        this.frame = event.data.bitmap;
      }
      if (event.data.type === "day") {
        this.map.set(event.data.date, event.data.bitmap);
        this.calRenderer.act();
      }
    });
  }
  resize() {
    // Resized to width/height of grid only
    const s = scale();
    const width =
      (this.calRenderer.canvas.offsetWidth - this.calRenderer.gridOffset[0]) *
      s;
    const height = this.calRenderer.transform.hourPx * 24;
    s;
    const resizeParams = {
      width,
      height,
      scale: s,
      dayWidth: this.calRenderer.dayWidth,
    };
    this.worker.postMessage({ type: "resize", params: resizeParams });
  }
  updateDay() {
    // day renderering
    //       // this.eventCache.arr.map((event, index) => {
    //   // if (index > 1000) return false;
    //   const transform = this.eventCache.transformMap.get(event.id);
    //   const x = transform[0];
    //   const y = transform[1];
    //   if (transform) {
    //     this.ctx2D.fillStyle = "#ccccccaa";
    //     this.ctx2D.fillRect(x, y, this.dayColWidth - 5, 20);
    //     this.ctx2D.fillStyle = this.colourScheme.color;
    //     this.ctx2D.fillText(event.title, x, y);
    //   }
    // });
  }
  updateOffset() {
    // canvas methods
  }
  buffer() {
    // get buffer (when ready?)
  }
}
