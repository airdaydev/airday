import { DayLayout, calcDayLayout } from "./layout";
import { Theme } from "../colours";
import { renderDay } from "./render";

interface Transform {
  dayPx: number;
  hourPx: number;
  scale: number;
}

export class EventUIWorker {
  canvas: OffscreenCanvas;
  ctx2D: OffscreenCanvasRenderingContext2D;
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
  theme: Theme = "light";
  worker: boolean;
  constructor(worker: boolean) {
    this.worker = worker;
    this.canvas = new OffscreenCanvas(100, 100);
    // Regular ctx for transfering entire canvas bitmap
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D Canvas Context");
    this.ctx2D = ctx;
    this.ctx2D.imageSmoothingEnabled = false;
    if (worker) {
      self.addEventListener("message", this.onMessage);
    }
  }
  offscreenScale() {
    this.canvas.width = this.transform.dayPx * this.transform.scale;
    this.canvas.height = this.transform.hourPx * 25 * this.transform.scale;
    this.ctx2D.scale(this.transform.scale, this.transform.scale);
  }
  onMessage = (message: MessageEvent) => {
    if (message.data.type === "config") {
      this.transform.dayPx = message.data.params.dayPx || 100;
      this.transform.hourPx = message.data.params.hourPx;
      this.transform.scale = message.data.params.scale;
      this.theme = message.data.params.theme;
      this.offscreenScale();
    }
    if (message.data.type === "next") {
      const { date, events, transform, theme = "light" } = message.data;
      this.transform.dayPx = transform[0];
      this.transform.hourPx = transform[1];
      this.transform.scale = transform[2];
      this.offscreenScale();
      const layout = calcDayLayout(events, date, transform[0], transform[1]);
      this.renderDay(layout, date, theme);
      const bitmap = this.canvas.transferToImageBitmap();
      self.postMessage(
        {
          type: "next",
          bitmap,
          date,
          layout,
        },
        [bitmap],
      );
    }
  };
  renderDay(layout: DayLayout, clip: number, theme = this.theme) {
    return renderDay(this.ctx2D, layout, clip, { theme });
  }
}
