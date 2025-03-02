import { CalendarTransform } from "./transform";
import { lightScheme, darkScheme, Theme } from "./colours";
import { EventDB } from "./state";
import { resizeCanvas2D, clearCanvas, createCanvasLayer } from "./canvas";
import { getStartOfWeekUTC } from "./time";
import { CalUIObjects } from "./ui-objects";
import { allDayLabel, hzLine, timeNow } from "./elements/label";
import { days, times } from "./elements/grid";
import { eventComposition } from "./elements/event-composition";
import { EventRenderCoordinator } from "./events/coordinator";
import { interactions } from "./elements/interactions";

type TimeFormat = "24hr" | "12hr";

// Primary Calendar component, mounts to a DOM element
export class AirdayCal {
  scrollable: HTMLDivElement;
  scrollChild: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx2D: CanvasRenderingContext2D;
  theme: Theme = "dark";
  db: EventDB;
  transform: CalendarTransform;
  timeFormat: TimeFormat = "24hr";
  resized = false;
  TIME_FONT_SIZE = 11;
  lastAction: number = performance.now();
  autoscrolling = false;
  firstRender: number | null = null; // Used to fade in first events
  // current scene objects
  hover: [number, number] | null = null; // relative date, time 0-24
  coordinator = new EventRenderCoordinator(this);
  canvasBounds: DOMRect;
  uiObjects = new CalUIObjects(this);
  stats?: Stats;
  // Interactions
  dragSelect = false;
  constructor(container: HTMLDivElement, db: EventDB, stats?: Stats) {
    if (stats) this.stats = stats;
    this.transform = new CalendarTransform(this);
    this.db = db;
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
  // TODO: Reevaluate and annotate
  getMousePos(event: MouseEvent) {
    // Time
    const y = event.y - this.canvasBounds.top - 1; // TODO: not entirely sure why this is 1px off (as tested on MacOS+Linux/FF)
    const timeY = this.transform.yToTime(y);
    // Day
    const x = event.x - this.canvasBounds.left;
    const day = this.transform.xToDay(x);
    const relDay = Math.floor(
      (event.x - this.transform.startPx) / this.transform.dayPx,
    );
    const absDay = this.transform.dates[relDay];
    const xDay = (event.x - this.transform.startPx) % this.transform.dayPx;
    if (!absDay) {
      return console.warn(
        "TODO: no absDay available, dev stink to be resolved",
      );
    }
    this.hover = [day, timeY];
    return {
      day,
      xDay,
      absDay,
      y,
      yOffset: y - this.transform.gridOffset[1] + this.transform.offset[1],
      timeY,
    };
  }
  mouseMove(event: MouseEvent) {
    const pos = this.getMousePos(event);
    if (!pos) return;
    this.hover = [pos.day, pos.timeY];
    this.uiObjects.testCollision(pos.absDay.valueOf(), [
      pos.xDay,
      pos.y - this.transform.gridOffset[1] + this.transform.offset[1],
    ]);
    this.act();
  }
  mouseDown(event: MouseEvent) {
    if (event.shiftKey) {
      // TODO: Start drag select
      this.dragSelect = true;
      // on mouse up
    }
    // TODO: Regular drag (drag time slot)
    // Regular drag of event
    // Regular drag of event top edge
    // Regular drag of event bottom edge
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
    this.coordinator.clearBitmapCache();
    this.act();
  };
  get scrollHeight() {
    return (
      this.transform.hourPx * 24 +
      this.transform.gridOffset[1] +
      this.TIME_FONT_SIZE
    );
  }
  act = () => (this.lastAction = performance.now());
  goToDate = (date: Date = new Date(getStartOfWeekUTC(new Date()))) => {
    this.transform.originDate = date.valueOf();
  };
  resizeCal = () => {
    resizeCanvas2D(this.canvas);
    this.transform.fitCalWidth(this.canvas.offsetWidth);
    this.resized = false;
    // TODO: Debounce this (or reevaluate entire cache mgmt):
  };
  // Main draw loop; run inside a request animation frame
  draw() {
    if (this.resized) {
      this.resizeCal();
    }
    this.transform.recalcClipspace(); // TODO: This makes sense to calc during render loop - but update dependent vals prior
    this.coordinator.tick();
    clearCanvas(this.canvas);
    days(this, this.transform.dates, this.transform.startPx); // TODO: for labels, only updates if x val changes, however for grid lines maybe always
    times(this, this.transform.firstHour, this.transform.firstHourPx); // TODO: This only needs to update if y val changes, however for grid lines - always
    // Start Header (no need for update unless x val changes)
    allDayLabel(this); // only moves if day area is expanded
    hzLine(this, this.transform.headerHeight); // only moves if day area is expanded
    hzLine(this, this.transform.gridOffset[1]); // only moves if day area is expanded
    // End Header
    interactions(this);
    eventComposition(this, this.transform.dates, this.transform.startPx); // days only update when dirty - or x/y updated
    timeNow(this); // this sits over everything - but only needs to update once per minute when idle!
  }
  frame() {
    requestAnimationFrame(() => {
      this.stats?.begin();
      if (performance.now() - this.lastAction < 100) {
        this.draw();
      }
      this.frame();
      this.stats?.end();
    });
  }
  cleanUp() {}
}
