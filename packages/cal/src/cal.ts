import { CalendarTransform } from "./transform";
import { lightScheme, darkScheme, Theme } from "./colours";
import { EventDB } from "./state";
import { resizeCanvas2D, clearCanvas, createCanvasLayer } from "./canvas";
import { getStartOfWeekUTC } from "./time";
import { CalUIObjects } from "./ui-objects";
import { allDayLabel, hzLine } from "./elements/label";
import { days, times } from "./elements/grid";
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
    this.scrollable.scrollTo(50000, 0);
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
      // delta between each scroll event / time = velocity
      // current spot = limit of movement
      // this would introduce a slight lag but may look much better on safari ios for example, where the scroll event is fired at a slow rate.
      // while scrolling calculate
      // TODO: not really a problem on desktop: so consider listening to touchstart/touchmove events directly on iOS before implementing this!
      event.preventDefault();
      this.transform.offset[1] = this.scrollable.scrollTop;
      this.transform.offset[0] = this.scrollable.scrollLeft;
      this.act();
    });
    this.canvas.addEventListener("wheel", (event: WheelEvent) => {
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
    // TODO: This may have to go in interactions/ui-objects - or just check if we've hit something
    if (event.shiftKey) {
      // TODO: Start drag select
      this.dragSelect = true;
      // we need to place an origin for the selection box, after a few px movement we can start a 1x1 outlined box
      // and update with each frame from origin
      // add a mouse up event here too (or maybe it's just active all the time) and kill the dragSelect when finished
    }
    if (!event.shiftKey) {
      // && no event
      // TODO: Regular drag (drag time slot)
    }
    if (!event.shiftKey) {
      // && event!
      // Regular drag of event (everything internal, except the edges!)
      // Regular drag of event internal adjacent to top edge - drag start of event (can invert to end of event)
      // Regular drag of event internal adjacent to bottom edge - drag end of event (can invert to start of event)
      // - nb. ghost event stays in place, while opaque event gets dragged
    }
  }
  mount = (container: HTMLElement) => {
    // Scrollable area
    const scrollable = document.createElement("div");
    scrollable.id = "airday_scrollable";
    scrollable.style.position = "absolute";
    scrollable.style.top = "6em";
    scrollable.style.left = "3em";
    scrollable.style.width = "calc(100% - 3em)";
    scrollable.style.height = "calc(100% - 6em)";
    scrollable.style.overflowY = "scroll";
    scrollable.style.zIndex = "2";
    scrollable.style.background = "#ffff000f";
    // Scrolling content (empty)
    const scrollChild = document.createElement("div");
    scrollChild.id = "airday_scroll_child";
    scrollChild.style.width = "100000px";
    scrollChild.style.background = "linear-gradient(red, blue)";
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
    // timeNow(this); // this sits over everything - but only needs to update once per minute when idle!
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
