import { DayLayout, calcDayLayout } from "./layout";

interface Transform {
  dayPx: number;
  hourPx: number;
  scale: number;
}

export class EventUIWorker {
  transform: Transform = {
    dayPx: 100,
    hourPx: 25,
    scale: 1,
  };
  range = [0, 0];
  idCache = new Map<string, any>();
  layoutMap = new Map<number, DayLayout>();
  cache = new Map<number, Set<string>>(); // unsorted
  dirty = new Set<number>();
  worker: boolean;
  constructor(worker: boolean) {
    this.worker = worker;
  }
  onMessage = (message: MessageEvent) => {
    if (message.data.type === "config") {
      this.transform.dayPx = message.data.params.dayPx || 100;
      this.transform.hourPx = message.data.params.hourPx;
      this.transform.scale = message.data.params.scale;
    }
    if (message.data.type === "next") {
      const { date, events, transform } = message.data;
      this.transform.dayPx = transform[0];
      this.transform.hourPx = transform[1];
      this.transform.scale = transform[2];
      const layout =
        message.data.layout ||
        calcDayLayout(events, date, transform[0], transform[1]);
      self.postMessage({
        type: "next",
        date,
        layout,
      });
    }
  };
}
