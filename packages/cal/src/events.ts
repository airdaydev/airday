import { CalRenderer } from "./render";
import { CalendarEvent } from "./model";
import { EventDB } from "./state";
import { getCanvasContext, scale } from "./canvas";
import { getStartOfDay } from "./time";

// EventRenderer runs in a webworker & handles retrieval, indexing & rendering of events
// It renders a day at a time, marking days as dirty as required
//
export class EventCache {
  renderer: CalRenderer;
  db: EventDB;
  map = new Map<number, Set<CalendarEvent>>();
  transformMap = new Map<string, { x: number; y: number }>();
  range: [number, number] | null;
  arr: CalendarEvent[] = []; // temp array of all events
  constructor(renderer: CalRenderer, db: EventDB) {
    this.renderer = renderer;
    this.db = db;
  }
  private loadEvents(events: CalendarEvent[]) {
    this.renderer.eventRenderer.worker.postMessage({
      type: "load",
      events: events.map((e) => e.transfer()), // TODO: Date to number
      range: this.range,
    });
    // events.forEach((event) => {
    //   this.transformMap.set(event.id, [
    //     this.renderer.transform.dateToX(event.start),
    //     this.renderer.transform.timeToY(event.start),
    //   ]);
    // });
  }
  updateRange(range: [Date, Date]) {
    const lastRange = this.range;
    this.range = [range[0].valueOf(), range[1].valueOf()];
    if (!lastRange) {
      const events = this.db.getEvents(range[0], range[1]);
      // New range is completely outside
      this.loadEvents(events);
      return;
    }
    if (range[1].valueOf() < lastRange[0]) {
      // Range is entirely to the left of existing
      const events = this.db.getEvents(range[0], range[1]);
      this.loadEvents(events);
      return;
    }
    if (range[0].valueOf() > lastRange[1]) {
      // Range is entirely to the right of existing
      const events = this.db.getEvents(range[0], range[1]);
      this.loadEvents(events);
      return;
    }
    // Clear previous ranges
    if (range[0].valueOf() > lastRange[0]) {
      // clear between
    }
    if (range[1].valueOf() < lastRange[0]) {
      // clear between
    }
    // Load new ranges
    let newEvents = [];
    if (range[0].valueOf() < lastRange[0]) {
      // range before
      newEvents.push(...this.db.getEvents(range[0], new Date(lastRange[0])));
    }
    if (range[1].valueOf() > lastRange[1]) {
      // range after
      newEvents.push(...this.db.getEvents(new Date(lastRange[1]), range[1]));
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
      }
    });
  }
  resize() {
    // Resized to width/height of grid only
    const s = scale();
    const width =
      (this.calRenderer.canvas.offsetWidth - this.calRenderer.gridOffset[0]) *
      s;
    const height =
      (this.calRenderer.canvas.offsetHeight - this.calRenderer.gridOffset[1]) *
      s;
    const resizeParams = { width, height, scale: s };
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
