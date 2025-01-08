import { CalRenderer } from "./render";
import { CalendarEvent } from "./model";
import { EventDB } from "./state";
import { getCanvasContext } from "./canvas";

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
    this.arr = events;
    events.forEach((event) => {
      this.transformMap.set(event.id, [
        this.renderer.transform.dateToX(event.start),
        this.renderer.transform.timeToY(event.start),
      ]);
    });
  }
  addRange(range: [Date, Date]) {
    if (!this.range) {
      const events = this.db.getEvents(range[0], range[1]);
      this.loadEvents(events);
    }
    if (this.range && range[1].valueOf() < this.range[0]) {
      const events = this.db.getEvents(range[0], range[1]);
      this.loadEvents(events);
    }
    if (this.range && range[0].valueOf() > this.range[1]) {
      const events = this.db.getEvents(range[0], range[1]);
      this.loadEvents(events);
    }
    this.range = [range[0].valueOf(), range[1].valueOf()];
  }
  // if (
  //   (this.eventCacheRange &&
  //     clipspaceX[1].valueOf() < this.eventCacheRange[0]) ||
  //   (this.eventCacheRange &&
  //     clipspaceX[0].valueOf() > this.eventCacheRange[1])
  // ) {
  //   // Clipspace is entirely before, or after existing cache range
  //   const events = this.db.getEvents(
  //     clipspaceX[0].valueOf(),
  //     clipspaceX[1].valueOf(),
  //   );
}

export class EventRenderer {
  calRenderer: CalRenderer;
  canvas: OffscreenCanvas;
  ctx2D: OffscreenCanvasRenderingContext2D;
  constructor(calRenderer: CalRenderer) {
    // get grid size from parent, must connect to resize event from parent
    this.calRenderer = calRenderer;
    this.canvas = new OffscreenCanvas(100, 100);
    this.ctx2D = getCanvasContext(this.canvas);
  }
  resize() {}
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
