import { EventCache, EventWorkerComms } from "./events/cache";
import { CalendarTransform } from "./transform";
import { lightScheme, darkScheme, Theme } from "./colours";
import { EventDB } from "./state";
import { getCanvasContext, resizeCanvas2D, clearCanvas } from "./canvas";
import {
  getStartOfWeekUTC,
  getDateUTC,
  getDateArray,
  isWeekend,
  DayRange,
  isTodayUTC,
} from "./time";

const foxPng = "https://minio.gormly.co/airday/fox.png";

type TimeFormat = "24hr" | "12hr";

const TIME_FONT_SIZE = 11;

// Virtual calendar view: Reset origin at each DAY_BUFFER days start day
// Reset origin RESET_POINT days out either direction
// scroll auto snaps to nearest day

const iconCache = new Map<string, ImageBitmap>();

export class CalRenderer {
  scrollable: HTMLDivElement;
  scrollChild: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx2D: CanvasRenderingContext2D;
  theme: Theme = "dark";
  dayPx = 100;
  headerHeight = 50; // aka header height
  allDayRowHeight = 50;
  transform: CalendarTransform;
  timeFormat: TimeFormat = "24hr";
  margin = 10;
  daysVisible = 7;
  daysBuffer = 2;
  resized = false;
  originDate = getStartOfWeekUTC(new Date());
  lastAction: number = performance.now();
  autoscrolling = false;
  firstRender: number | null = null; // Used to fade in first events
  // current scene objects
  hover: [number, number] | null = null; // relative date, time 0-24
  startDay?: Date;
  eventCache: EventCache;
  eventWorkerComms: EventWorkerComms;
  constructor(container: HTMLDivElement, db: EventDB) {
    this.transform = new CalendarTransform(this);
    this.eventCache = new EventCache(this, db);
    this.eventWorkerComms = new EventWorkerComms(this);
    const { scrollable, scrollChild, canvas, ctx2D } = this.mount(container);
    this.scrollable = scrollable;
    this.canvas = canvas;
    this.scrollChild = scrollChild;
    this.scrollChild.style.height = `${this.scrollHeight}px`; // Additional px to display 24:00
    this.ctx2D = ctx2D;
    this.canvas.style.transform = "translateZ(0)";
    this.ctx2D.imageSmoothingEnabled = false;
    this.resizeCal();
    this.frame();
    // TODO: Destroy
    const resizeObserver = new ResizeObserver(() => {
      this.resized = true;
      this.act();
    });
    resizeObserver.observe(canvas);
    scrollable.addEventListener("scroll", (event) => {
      event.preventDefault();
      this.transform.offset[1] = this.scrollable.scrollTop;
      this.act();
    });
    scrollable.addEventListener("wheel", (event: WheelEvent) => {
      this.transform.addDelta(event.deltaX, event.deltaY);
      this.mouseMove(event);
      this.act();
    });
    scrollable.addEventListener("mousemove", (event: MouseEvent) => {
      this.mouseMove(event);
    });
    this.resizeCal();
    this.frame();
    this.goToDate();
    this.loadPng(foxPng);
  }
  get colourScheme() {
    if (this.theme === "light") return lightScheme;
    else return darkScheme;
  }
  mouseMove(event: MouseEvent) {
    const bounds = this.canvas.getBoundingClientRect();
    const x = event.x - bounds.left;
    const y = event.y - bounds.top - 1; // TODO: not entirely sure why this is 1px off (as tested on MacOS)
    this.hover = [this.transform.xToDay(x), this.transform.yToTime(y)];
    this.act();
  }
  get clipDays() {
    return this.daysVisible + 3;
  }
  loadPng = async (url: string) => {
    const data = await fetch(url);
    const blob = await data.blob();
    const bmp = await createImageBitmap(blob);
    iconCache.set(url, bmp);
  };
  mount = (container: HTMLElement) => {
    // Scrollable area
    const scrollable = document.createElement("div");
    scrollable.id = "airday_scrollable";
    scrollable.style.position = "absolute";
    scrollable.style.top = "0";
    scrollable.style.left = "0";
    scrollable.style.width = "100%";
    scrollable.style.height = "100%";
    scrollable.style.overflowY = "scroll";
    scrollable.style.zIndex = "2";
    // Scrolling content (empty)
    const scrollChild = document.createElement("div");
    scrollChild.id = "airday_scroll_child";
    scrollChild.style.width = "100%";
    // Canvas (sits behind)
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const ctx2D = getCanvasContext(canvas);
    // Attach everything
    scrollable.append(scrollChild);
    container.appendChild(scrollable);
    container.appendChild(canvas);
    return {
      scrollable,
      scrollChild,
      canvas,
      ctx2D,
    };
  };
  changeTheme = (theme: Theme) => {
    this.theme = theme;
    this.eventWorkerComms.resize();
    console.log("clearing cache range & bitmap");
    this.eventCache.bitmapMap.clear();
    this.eventCache.range = null;
    this.act();
  };
  get scrollHeight() {
    return this.transform.hourPx * 24 + this.gridOffset[1] + TIME_FONT_SIZE;
  }
  act = () => (this.lastAction = performance.now());
  goToDate = (date: Date = new Date(getStartOfWeekUTC(new Date()))) => {
    this.originDate = date.valueOf();
  };
  // TODO: Consider debouncing
  resizeCal = () => {
    resizeCanvas2D(this.canvas);
    const approxDay = this.transform.offset[0] / this.dayPx;
    this.dayPx =
      (this.canvas.offsetWidth - this.transform.hourPx) / this.daysVisible;
    this.transform.offset[0] = approxDay * this.dayPx;
    this.eventWorkerComms.resize();
    this.resized = false;
    // TODO: Debounce this (or reevaluate entire cache mgmt):
    this.eventCache.range = null;
  };
  get gridOffset() {
    return [50, this.headerHeight + this.allDayRowHeight];
  }
  clipspace(): [Date[], number, Date, DayRange] {
    const [startDayPx, relStartDay] = this.transform.clipspaceOriginX(); // TODO: memoise
    const clipStartDayAbs = new Date(
      this.originDate.valueOf() + relStartDay * 864e5,
    );
    const dates = getDateArray(clipStartDayAbs.valueOf(), this.clipDays + 5);
    const clipspaceRange = new DayRange(dates[0], this.clipDays + 5);
    return [dates, startDayPx, clipStartDayAbs, clipspaceRange];
  }
  draw() {
    if (this.resized) {
      this.resizeCal();
    }
    clearCanvas(this.canvas);
    const [dates, startDayPx, _, clipspaceRange] = this.clipspace(); // TODO: Only necessary in resize/movement
    const [firstHour, firstHourPx] = this.transform.getVisibleHours();
    this.eventCache.updateRange(clipspaceRange);
    this.days(dates, startDayPx);
    this.times(firstHour, firstHourPx);
    this.header();
    this.interactions();
    this.events(dates, startDayPx);
    this.timeNow();
    this.debug();
  }
  frame() {
    requestAnimationFrame(() => {
      if (performance.now() - this.lastAction < 100) {
        this.draw();
      }
      this.frame();
    });
  }
  header() {
    // bg optional
    // this.ctx2D.fillStyle = this.colourScheme.bg;
    // this.ctx2D.fillRect(0, 0, this.canvas.width, this.gridOffset[1]);
    this.allDayLabel();
    this.hzLine(this.headerHeight);
    this.hzLine(this.gridOffset[1]);
  }
  timeNow() {
    const now = new Date();
    const y = this.transform.timeToY(now);
    const nowHour = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;
    this.ctx2D.textAlign = "right";
    this.ctx2D.textBaseline = "middle";
    this.ctx2D.font = `${TIME_FONT_SIZE}px Alte Haas Grotesk`;
    this.hzLine(y, { strokeStyle: "#ff0000cc", lineWidth: 0.5 });
    this.ctx2D.fillStyle = "#ff0000cc";
    this.ctx2D.fillText(
      `${nowHour.toString()}`,
      this.gridOffset[0] - this.margin,
      y,
    );
  }
  times(firstHour: number, firstHourPx: number) {
    this.ctx2D.textAlign = "right";
    this.ctx2D.textBaseline = "middle";
    this.ctx2D.font = `${TIME_FONT_SIZE}px Alte Haas Grotesk`;
    let pxOffset = firstHourPx + this.gridOffset[1];
    this.ctx2D.save();
    const path = new Path2D();
    path.rect(
      0,
      this.gridOffset[1],
      this.canvas.offsetWidth,
      this.canvas.offsetHeight,
    );
    this.ctx2D.clip(path);
    const now = new Date();
    const y = this.transform.timeToY(now);
    this.ctx2D.fillStyle = this.colourScheme.labels;
    for (
      let i = firstHour;
      i <=
      firstHour + this.transform.hoursVisible(this.scrollable.offsetHeight);
      i++
    ) {
      if (i >= 1 && i <= 24) {
        if (Math.abs(pxOffset - y) < TIME_FONT_SIZE) {
          // Hides time if obscured by current hour
        } else {
          this.ctx2D.fillText(
            `${i.toString().padStart(2, "0")}:00`,
            this.gridOffset[0] - this.margin,
            pxOffset,
          );
        }
        this.hzLine(pxOffset);
      }
      pxOffset += this.transform.hourPx;
    }
    this.ctx2D.restore();
  }
  days(dates: Date[], offsetPx: number) {
    this.ctx2D.save();
    const path = new Path2D();
    path.rect(
      this.gridOffset[0],
      0,
      this.canvas.offsetWidth,
      this.canvas.offsetHeight,
    );
    this.ctx2D.clip(path);
    dates.map((date, index) => {
      const offset = index * this.dayPx + offsetPx;
      if (isWeekend(date)) {
        // Weekend shading
        this.ctx2D.fillStyle = this.colourScheme.shade;
        this.ctx2D.fillRect(
          offset,
          this.headerHeight,
          this.dayPx,
          this.canvas.offsetHeight,
        );
      }
      this.vtLine(offset, this.headerHeight);
      this.dayLabel(date, offset);
    });
    this.ctx2D.restore();
  }
  // TODO: Potential optimisation, only re-render image when delivered, otherwise use a transform
  // Also: Tile regions
  events(dates: Date[], offsetPx: number) {
    this.ctx2D.save();
    const path = new Path2D();
    path.rect(
      this.gridOffset[0],
      this.gridOffset[1],
      this.canvas.offsetWidth,
      this.canvas.offsetHeight,
    );
    this.ctx2D.clip(path);
    this.ctx2D.font = "8px Departure Mono";
    this.ctx2D.textAlign = "left";
    this.ctx2D.textBaseline = "top";
    dates.map((date, index) => {
      const offset = index * this.dayPx + offsetPx;
      const image = this.eventCache.bitmapMap.get(date.valueOf());
      if (image) {
        if (!this.firstRender) this.firstRender = performance.now();
        if (this.firstRender) {
          const diff = performance.now() - this.firstRender;
          this.ctx2D.globalAlpha = diff < 150 ? diff / 150 : 1;
          if (diff < 150) this.act();
        }
        this.ctx2D.drawImage(
          image,
          offset,
          -this.transform.offset[1] + this.gridOffset[1],
          this.dayPx,
          this.transform.hourPx * 25,
        );
        this.ctx2D.globalAlpha = 1;
      }
      // const fox = iconCache.get(foxPng);
      // if (fox && date.getDay() === 5) {
      //   this.ctx2D.drawImage(
      //     fox,
      //     offset + this.margin,
      //     -this.transform.offset[1] + 500,
      //     this.dayPx - this.margin,
      //     this.dayPx - this.margin,
      //   );
      // }
    });
    this.ctx2D.restore();
  }
  // TODO: Start from interactions
  interactions() {
    if (!this.hover) return;
    const [relDay, time] = this.hover;
    if (time < 0 || time > 25) return;
    const x =
      this.gridOffset[0] - this.transform.offset[0] + relDay * this.dayPx;
    const y =
      time * this.transform.hourPx -
      this.transform.offset[1] +
      this.gridOffset[1];
    this.ctx2D.fillStyle = "#000055aa";
    this.ctx2D.rect(x, y, this.dayPx, 50);
    this.ctx2D.fill();
  }
  allDayLabel() {
    this.ctx2D.fillStyle = this.colourScheme.color;
    this.ctx2D.font = "12px Alte Haas Grotesk";
    this.ctx2D.textAlign = "right";
    this.ctx2D.textBaseline = "middle";
    this.ctx2D.fillStyle = this.colourScheme.labels;
    this.ctx2D.fillText(
      "All day",
      this.gridOffset[0] - this.margin,
      this.headerHeight + this.allDayRowHeight / 2,
    );
  }
  dayLabel(date: Date, offset: number) {
    const text = getDateUTC(date);
    this.ctx2D.textAlign = "left";
    const textWidth = this.ctx2D.measureText(text).width;
    const padding = (this.dayPx - textWidth) / 2;
    if (isTodayUTC(date)) {
      this.ctx2D.fillStyle = "red";
      this.ctx2D.roundRect(offset + padding - 4, 14, textWidth + 8, 25, 2);
      this.ctx2D.fill();
      this.ctx2D.font = "bold 12px Alte Haas Grotesk";
      this.ctx2D.fillStyle = "white";
    } else {
      this.ctx2D.fillStyle = this.colourScheme.labels;
      this.ctx2D.font = "12px Alte Haas Grotesk";
    }
    this.ctx2D.fillText(text, offset + padding, 25);
  }
  hzLine(
    yOffset: number,
    opts: {
      strokeStyle?: string;
      lineWidth?: number;
    } = {},
  ) {
    this.ctx2D.strokeStyle = opts.strokeStyle || this.colourScheme.hzLine;
    this.ctx2D.beginPath();
    this.ctx2D.lineWidth = opts.lineWidth || 1;
    this.ctx2D.moveTo(this.gridOffset[0], yOffset);
    this.ctx2D.lineTo(this.canvas?.offsetWidth, yOffset);
    this.ctx2D.stroke();
  }
  vtLine(xOffset: number, yStart: number) {
    this.ctx2D.strokeStyle = this.colourScheme.vtLine;
    this.ctx2D.beginPath();
    this.ctx2D.lineWidth = 0.75;
    this.ctx2D.moveTo(xOffset, yStart);
    this.ctx2D.lineTo(xOffset, this.canvas?.offsetHeight);
    this.ctx2D.stroke();
  }
  debug() {
    this.ctx2D.textAlign = "right";
    this.ctx2D.fillText(
      `Offset: ${this.transform.offset}`,
      this.canvas.offsetWidth - this.margin,
      this.canvas?.offsetHeight - 12,
    );
  }
  cleanUp() {}
}
