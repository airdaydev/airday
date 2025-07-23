import {
  calcAllDayContracted,
  calcDayLayout,
  calcExpandedAllDayLayout,
} from "./layout";

interface Transform {
  dayPx: number;
  hourPx: number;
}

export class EventUIWorker {
  transform: Transform = {
    dayPx: 100,
    hourPx: 25,
  };
  worker: boolean;
  constructor(worker: boolean) {
    this.worker = worker;
    if (worker) {
      self.addEventListener("message", this.onMessage);
    }
  }
  onMessage = (message: MessageEvent) => {
    if (message.data.type === "day") {
      const { date, events, transform } = message.data;
      this.transform.dayPx = transform[0];
      this.transform.hourPx = transform[1];
      const layout =
        message.data.layout || calcDayLayout(events, date, transform[1]);
      self.postMessage({
        type: "day",
        date,
        layout,
      });
    }
    if (message.data.type === "all-day-sml") {
      const { cache, dates } = message.data;
      const layout = calcAllDayContracted(cache, dates);
      self.postMessage({
        type: "all-day-sml",
        ...layout,
      });
    }
    if (message.data.type === "all-day-lrg") {
      const { events } = message.data;
      const layout = calcExpandedAllDayLayout(events);
      self.postMessage({
        type: "all-day-lrg",
        layout,
      });
    }
  };
}
