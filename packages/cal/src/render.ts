import { EventCache, EventWorkerComms } from "./events/cache";
import { CalendarTransform, Clipspace } from "./transform";
import { lightScheme, darkScheme, Theme } from "./colours";
import { EventDB } from "./state";
import { resizeCanvas2D, clearCanvas, createCanvasLayer } from "./canvas";
import { getStartOfWeekUTC, localZeroDate } from "./time";
import { CalUIObjects } from "./ui-objects";
import Stats from "stats.js";
import { allDayLabel, hzLine, timeNow } from "./elements/label";
import { days, times } from "./elements/grid";
import { eventComposition } from "./elements/event-composition";

var stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

type TimeFormat = "24hr" | "12hr";

export class CalRenderer {
  scrollable: HTMLDivElement;
  scrollChild: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx2D: CanvasRenderingContext2D;
  theme: Theme = "dark";
  headerHeight = 50; // aka header height
  allDayRowHeight = 50;
  transform: CalendarTransform;
  timeFormat: TimeFormat = "24hr";
  margin = 10;
  daysVisible = 7;
  daysBuffer = 2;
  resized = false;
  TIME_FONT_SIZE = 11;
  lastAction: number = performance.now();
  autoscrolling = false;
  firstRender: number | null = null; // Used to fade in first events
  clipspace = new Clipspace(this);
  // current scene objects
  hover: [number, number] | null = null; // relative date, time 0-24
  startDay?: Date;
  eventCache: EventCache;
  eventWorkerComms: EventWorkerComms;
  canvasBounds: DOMRect;
  uiObjects = new CalUIObjects(this);
  constructor(container: HTMLDivElement, db: EventDB) {
    this.transform = new CalendarTransform(this);
    this.eventCache = new EventCache(this, db);
    this.eventWorkerComms = new EventWorkerComms(this);
    const { scrollable, scrollChild, canvas, ctx2D } = this.mount(container);
    this.scrollable = scrollable;
    this.canvas = canvas;
    this.canvasBounds = this.canvas.getBoundingClientRect();
    this.scrollChild = scrollChild;
    this.scrollChild.style.height = `${this.scrollHeight}px`; // Additional px to display 24:00
    this.ctx2D = ctx2D;
    this.resizeCal();
    this.frame();
    // TODO: Destroy
    const resizeObserver = new ResizeObserver(() => {
      this.canvasBounds = this.canvas.getBoundingClientRect();
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
    scrollable.addEventListener("mousedown", (event: MouseEvent) => {
      this.mouseDown(event);
    });
    this.resizeCal();
    this.frame();
    this.goToDate();
  }
  get colourScheme() {
    if (this.theme === "light") return lightScheme;
    else return darkScheme;
  }
  mouseMove(event: MouseEvent) {
    const x = event.x - this.canvasBounds.left;
    const y = event.y - this.canvasBounds.top - 1; // TODO: not entirely sure why this is 1px off (as tested on MacOS+Linux/FF)
    const day = this.transform.xToDay(x); // TODO: Are we doing too much work here!?
    const relDay = Math.floor(
      (event.x - this.clipspace.startPx) / this.transform.dayPx,
    );
    const absDay = this.clipspace.dates[relDay];
    const xDay = (event.x - this.clipspace.startPx) % this.transform.dayPx;
    if (!absDay)
      return console.warn(
        "TODO: no absDay available, dev stink to be resolved",
      ); //
    this.uiObjects.testCollision(absDay.valueOf(), [
      xDay,
      y - this.gridOffset[1] + this.transform.offset[1],
    ]);
    this.hover = [day, this.transform.yToTime(y)];
    this.act();
  }
  mouseDown(event: MouseEvent) {
    // TODO: Are we in grid space!?
    const relDay = Math.floor(
      (event.x - this.clipspace.startPx) / this.transform.dayPx,
    );
    const day = this.clipspace.dates[relDay];
    this.eventCache.reflowDay(localZeroDate(day).valueOf());
  }
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
    const { canvas, ctx2D } = createCanvasLayer();
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
    this.eventCache.bitmapMap.clear();
    this.eventCache.range = null;
    this.act();
  };
  get scrollHeight() {
    return (
      this.transform.hourPx * 24 + this.gridOffset[1] + this.TIME_FONT_SIZE
    );
  }
  act = () => (this.lastAction = performance.now());
  goToDate = (date: Date = new Date(getStartOfWeekUTC(new Date()))) => {
    this.clipspace.originDate = date.valueOf();
  };
  get clipDays() {
    return this.daysVisible + 3;
  }
  // TODO: Consider debouncing
  resizeCal = () => {
    resizeCanvas2D(this.canvas);
    const approxDay = this.transform.offset[0] / this.transform.dayPx;
    this.transform.dayPx =
      (this.canvas.offsetWidth - this.transform.hourPx) / this.daysVisible;
    this.transform.offset[0] = approxDay * this.transform.dayPx;
    this.eventWorkerComms.resize();
    this.resized = false;
    // TODO: Debounce this (or reevaluate entire cache mgmt):
    this.eventCache.range = null;
  };
  get gridOffset() {
    return [50, this.headerHeight + this.allDayRowHeight];
  }
  // TODO: Tidy & cache this function
  recalcClipspace(): void {
    const [startDayPx, relStartDay] = this.transform.clipspaceOriginX();
    this.clipspace.update(startDayPx, relStartDay);
  }
  draw() {
    if (this.resized) {
      this.resizeCal();
    }
    clearCanvas(this.canvas);
    this.recalcClipspace();
    const [firstHour, firstHourPx] = this.transform.getVisibleHours();
    this.eventCache.updateRange(this.clipspace.range);
    days(this, this.clipspace.dates, this.clipspace.startPx);
    times(this, firstHour, firstHourPx);
    // Start Header
    allDayLabel(this);
    hzLine(this, this.headerHeight);
    hzLine(this, this.gridOffset[1]);
    // End Header
    eventComposition(this, this.clipspace.dates, this.clipspace.startPx);
    // interactions();
    timeNow(this);
  }
  frame() {
    requestAnimationFrame(() => {
      stats.begin();
      if (performance.now() - this.lastAction < 100) {
        this.draw();
      }
      this.frame();
      stats.end();
    });
  }
  cleanUp() {}
}
