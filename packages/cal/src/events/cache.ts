import { CalRenderer } from "../render";
import { CalendarEvent } from "../model";
import { EventDB } from "../state";
import { scale } from "../canvas";
import { DayRange } from "../time";
import { DayLayout } from "./layout";
import { Rectangle } from "@timohausmann/quadtree-ts";
import { EventUIData } from "../ui-objects";

// EventRenderer runs in a webworker & handles retrieval, indexing & rendering of events
// It renders a day at a time, marking days as dirty as required
//
export class EventCache {
  renderer: CalRenderer;
  db: EventDB;
  bitmapMap = new Map<number, ImageBitmap>();
  layoutMap = new Map<number, DayLayout>();
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
    this.renderer.eventWorkerComms.worker.postMessage({
      type: "load",
      events: events.map((e) => e.transfer()), // TODO: Date to number
      range: [this.range.localStart.valueOf(), this.range.localEnd.valueOf()],
    });
  }
  reflowDay(clip: number) {
    this.renderer.eventWorkerComms.worker.postMessage({
      type: "reflow",
      clip,
    });
  }
  reflow(date: number, layout: DayLayout) {
    this.layoutMap.set(date, layout);
    const objs: Rectangle<EventUIData>[] = [];
    for (let [id, event] of layout.map.entries()) {
      objs.push(
        new Rectangle<EventUIData>({
          x: event.x,
          width: event.width,
          y: event.y,
          height: event.height,
          data: {
            type: 0,
            id,
          },
        }),
      );
    }
    this.renderer.uiObjects.updateDay(date, objs);
  }
  updateRange(range: DayRange) {
    const lastRange = this.range;
    this.range = range;
    if (!lastRange) {
      const events = this.db.getEvents(range.localStart, range.localEnd);
      // New range is completely outside
      this.loadEvents(events);
      return;
    }
    if (range.end.valueOf() < lastRange.start.valueOf()) {
      // Range is entirely to the left of existing
      const events = this.db.getEvents(range.localStart, range.localEnd);
      this.loadEvents(events);
      return;
    }
    if (range.start.valueOf() > lastRange.end.valueOf()) {
      // Range is entirely to the right of existing
      const events = this.db.getEvents(range.localStart, range.localEnd);
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
    if (range.start.valueOf() < lastRange.start.valueOf()) {
      // range before
      newEvents.push(
        ...this.db.getEvents(range.localStart, lastRange.localStart),
      );
    }
    if (range.end.valueOf() > lastRange.end.valueOf()) {
      // range after
      newEvents.push(...this.db.getEvents(lastRange.localEnd, range.localEnd));
    }
    if (newEvents.length) {
      this.loadEvents(newEvents);
    }
  }
}

// Performance test: translate vs rerender
export class EventWorkerComms {
  calRenderer: CalRenderer;
  worker: Worker;
  constructor(calRenderer: CalRenderer) {
    // get grid size from parent, must connect to resize event from parent
    this.calRenderer = calRenderer;
    this.worker = new Worker(new URL("./worker.ts?worker", import.meta.url), {
      type: "module",
    });
    this.worker.onerror = (error) => {
      console.error("Worker error:", error);
    };
    this.worker.addEventListener("message", (event) => {
      if (event.data.type === "day") {
        this.calRenderer.eventCache.bitmapMap.set(
          event.data.date,
          event.data.bitmap,
        );
        this.calRenderer.act();
      }
      if (event.data.type === "reflow") {
        this.calRenderer.eventCache.reflow(event.data.date, event.data.layout);
      }
    });
  }
  resize() {
    // Resized to width/height of grid only
    const s = scale();
    const width =
      (this.calRenderer.canvas.offsetWidth - this.calRenderer.gridOffset[0]) *
      s;
    s;
    const configParams = {
      width,
      scale: s,
      hourPx: this.calRenderer.transform.hourPx,
      dayPx: this.calRenderer.dayPx,
      theme: this.calRenderer.theme,
    };
    this.worker.postMessage({ type: "config", params: configParams });
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
