import { CalendarTransform } from "./transform";
import {
  lightScheme,
  darkScheme,
  Theme,
  lightEventSchemes,
  darkEventSchemes,
} from "./colours";
import { EventDB } from "./state";
import { utcZeroDate } from "./time";
import { EventRenderCoordinator } from "./events/coordinator";
import { createCalStyleTag, createColoursStyleTag } from "./css";
import { AnchorEl, NowMarker, TimesEl } from "./events/dom";

type TimeFormat = "24hr" | "12hr";

let globalIndex = 0; // track id

// Primary Calendar component, mounts to a DOM element
export class AirdayCal {
  id: string;
  container?: HTMLDivElement;
  scrollable?: HTMLDivElement;
  scrollChild?: HTMLDivElement;
  eventsContainer?: HTMLDivElement;
  nowMarker?: HTMLDivElement;
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
  stats?: Stats;
  // Interactions
  dragSelect = false;
  constructor(db: EventDB) {
    this.id = `airday-cal-${globalIndex}`;
    globalIndex++;
    createCalStyleTag(this.id);
    createColoursStyleTag(this.id, lightEventSchemes, darkEventSchemes);
    this.transform = new CalendarTransform(this);
    this.db = db;
  }
  mount = (container: HTMLDivElement) => {
    this.container = container;
    // Scrollable area
    container.id = this.id;
    const scrollable = document.createElement("div");
    scrollable.className = "scrollable";
    // Scrolling content (empty)
    const scrollChild = document.createElement("div");
    scrollChild.className = "scroll-child";
    scrollChild.style.width = `${this.transform.scrollChildWidth}px`;
    // Events container
    const eventsContainer = document.createElement("div");
    eventsContainer.className = "events-container";
    // All day events container
    const allDay = document.createElement("div");
    allDay.className = "all-day-events";
    // Now horizontal line marker
    const nowMarker = NowMarker(this);
    // Attach everything
    const labels = TimesEl(this);
    const anchor = AnchorEl();
    scrollable.appendChild(anchor);
    scrollable.append(scrollChild);
    container.appendChild(scrollable);
    scrollChild.appendChild(nowMarker);
    scrollChild.appendChild(allDay);
    scrollChild.appendChild(eventsContainer);
    scrollable.appendChild(labels);
    this.scrollable = scrollable;
    this.scrollChild = scrollChild;
    this.scrollChild.style.height = `${this.scrollHeight}px`; // Additional px to display 24:00
    this.eventsContainer = eventsContainer;
    this.nowMarker = nowMarker;
    this.resizeCal();
    this.transform.originDate = this.transform.calcOriginDate(); // TODO: Note that this is necessary
    // TODO: Destroy
    const resizeObserver = new ResizeObserver(() => {
      this.resized = true;
      this.act();
    });
    resizeObserver.observe(scrollable);
    scrollable.addEventListener("scroll", (event: Event) => {
      // delta between each scroll event / time = velocity
      // current spot = limit of movement
      // this would introduce a slight lag but may look much better on safari ios for example, where the scroll event is fired at a slow rate.
      // while scrolling calculate
      // TODO: not really a problem on desktop: so consider listening to touchstart/touchmove events directly on iOS before implementing this!
      event.preventDefault();
      this.transform.offset[1] = event.target.scrollTop;
      this.transform.offset[0] = event.target.scrollLeft;
      if (event.target.scrollTop < 10) {
        event.target.style.overscrollBehaviorY = "none";
      } else {
        // TODO: Don't set this so frequently (does the browser optimise for this?)
        event.target.style.overscrollBehaviorY = "auto";
      }
      this.act();
    });
    scrollable.addEventListener("mousemove", (event: MouseEvent) => {
      this.mouseMove(event);
    });
    scrollable.addEventListener("mousedown", (event: MouseEvent) => {
      this.mouseDown(event);
    });
    this.frame();
    this.scrollable.scrollTo(
      this.transform.dateToX(utcZeroDate(new Date()).valueOf()),
      0,
    );
  };
  enableStats(stats: Stats) {
    this.stats = stats;
  }
  get colourScheme() {
    if (this.theme === "light") return lightScheme;
    else return darkScheme;
  }
  mouseMove(event: MouseEvent) {
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
  changeTheme = (theme: Theme) => {
    this.theme = theme;
    if (this.container) this.container.className = theme;
    this.act();
  };
  daysVisible(count = 7) {
    if (count > 100) {
      console.warn(`Count cannot be greater than 100, count=${count}`);
      return;
    }
    this.transform.daysVisible = count;
    this.resized = true;
    this.act();
    // TODO: Provoke a resize via coordinator
  }
  get scrollHeight() {
    return this.transform.hourPx * 24;
  }
  act = () => (this.lastAction = performance.now());
  // TODO: Redo
  // goToDate = (date: Date = new Date(getStartOfWeekUTC(new Date()))) => {
  //   console.log("go to date");
  //   // this.transform.originDate = date.valueOf();
  // };
  resizeCal = () => {
    // Taking initial scroll position into account
    const nearestDayX = this.transform.refitCal(this.scrollable.offsetWidth);
    this.scrollable.scrollTo(nearestDayX - this.transform.timeColWidth, 0);
    this.scrollChild.style.width = `${this.transform.scrollChildWidth}px`;
    this.resized = false;
    // TODO: Debounce this (or reevaluate entire cache mgmt):
  };
  // Main draw loop; run inside a request animation frame
  draw() {
    if (this.resized) {
      this.resizeCal();
      this.coordinator.resize();
    }
    this.transform.updateClipspace();
    this.coordinator.tick();
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
