import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
import { getDateUTC, getTime, isTodayUTC, isWeekend } from "../time";
import { DayLayout, EventLayout } from "./layout";

function EventEl(layout: EventLayout, event: CalendarEvent) {
  const div = document.createElement("div");
  div.classList.add("event", event.color);
  div.style.top = `${layout.y}px`;
  div.style.left = `${layout.x * 100}%`;
  div.style.height = `${layout.height}px`;
  div.style.width = `${layout.width * 100}%`;
  div.style.zIndex = layout.segment.toString();
  if (!layout.startsToday) {
    div.style.borderRadius = "0 0 2px 2px";
  }
  if (layout.startsToday) {
    const title = document.createElement("div");
    title.className = "event-title";
    title.innerText = event.title;
    const time = document.createElement("div");
    time.className = "event-time";
    time.innerText = getTime(event.start.valueOf()); // TODO: Consider caching
    div.append(title, time);
  }
  return div;
}

export function GridLines(airdayCal: AirdayCal) {
  const gridlines = document.createElement("div");
  gridlines.className = "time-gridlines";
  let pxOffset = 0;
  for (let i = 0; i <= 24; i++) {
    if (i >= 1 && i <= 24) {
      // Horizontal line for the hour
      const hz = document.createElement("div");
      hz.className = "time-grid-lines";
      hz.style.top = `${pxOffset}px`;
      gridlines.appendChild(hz);
    }
    pxOffset += airdayCal.transform.hourPx;
  }
  return gridlines;
}

export function DayEl(airday: AirdayCal, date: number, xPos: number) {
  const jsDate = new Date(date);
  const weekend = isWeekend(jsDate);
  // Setup theme
  const dayEl = document.createElement("div");
  dayEl.className = "day";
  dayEl.setAttribute("data-date", date.toString());
  dayEl.style.transform = `translate(${xPos}px)`;
  dayEl.style.width = `${airday.transform.dayPx}px`;
  if (weekend) dayEl.classList.add("weekend");
  if (isTodayUTC(jsDate)) {
    dayEl.classList.add("today");
  }
  // sticky header
  const header = document.createElement("div");
  header.className = "day-header";
  // Date label
  const dateLabel = document.createElement("div");
  dateLabel.className = "date-label";
  const text = getDateUTC(jsDate);
  dateLabel.innerText = text;
  header.appendChild(dateLabel);
  // All day area (covers offset scroll area)
  const allDayArea = document.createElement("div");
  allDayArea.className = "all-day";
  header.appendChild(allDayArea);
  // append header
  dayEl.appendChild(header);
  // Debug label
  const debugLabel = document.createElement("div");
  debugLabel.className = "debug-date";
  debugLabel.innerText = jsDate.toUTCString();
  dayEl.appendChild(debugLabel);
  // Event container
  const dayEventsEl = document.createElement("div");
  dayEventsEl.className = "day-events";
  dayEl.appendChild(dayEventsEl);
  // GridLines
  const gridLines = GridLines(airday);
  dayEl.appendChild(gridLines);
  return dayEl;
}

export function appendDayLayout(
  container: HTMLElement,
  layout: DayLayout,
  data: Map<string, CalendarEvent>,
) {
  // console.log("wtf", data);
  // Create events
  const events: HTMLDivElement[] = [];
  layout.map.forEach((eventLayout) => {
    const event = data.get(eventLayout.id);
    if (event) {
      events.push(EventEl(eventLayout, event));
    } else {
      console.warn(`Event ${eventLayout.id} not found in data cache`);
    }
  });
  container.append(...events);
}

export function AnchorEl() {
  const anchor = document.createElement("div");
  anchor.className = "top-left-anchor";
  const tz = document.createElement("div");
  tz.className = "tz-button";
  tz.innerText = "AEST";
  anchor.appendChild(tz);
  const allDay = document.createElement("div");
  allDay.innerText = "All Day";
  allDay.className = "all-day-label";
  anchor.appendChild(allDay);
  return anchor;
}

export function TimesEl(airdayCal: AirdayCal) {
  const labels = document.createElement("div");
  labels.className = "time-label-col";

  let pxOffset = 0;
  const now = new Date();
  const y = airdayCal.transform.timeToY(now);

  for (let i = 0; i <= 24; i++) {
    if (i >= 1 && i <= 24) {
      if (Math.abs(pxOffset - y) < airdayCal.TIME_FONT_SIZE) {
        // Hides time if obscured by current hour
        // TODO: This needs to be updated at least ever
      } else {
        const label = document.createElement("div");
        label.className = "time-grid-label";
        label.textContent = `${i.toString().padStart(2, "0")}:00`;
        label.style.right = `${airdayCal.transform.margin}px`;
        label.style.top = `${pxOffset}px`;
        labels.appendChild(label);
      }
    }
    pxOffset += airdayCal.transform.hourPx;
  }
  return labels;
}

// TODO: Only display now marker when view has current date
// TODO: Don't update unless time actually changes
// - might be better to use set interval instead of updating on tick
export class NowMarker {
  airday: AirdayCal;
  container: HTMLDivElement;
  label: HTMLDivElement;
  constructor(airday: AirdayCal) {
    this.airday = airday;
    const container = document.createElement("div");
    this.container = container;
    container.className = "now-container";
    const label = document.createElement("div");
    label.className = "now-label";
    this.label = label;
    const marker = document.createElement("div");
    marker.className = "now-marker";
    this.update();
    container.append(label, marker);
    return this;
  }
  update() {
    const now = new Date();
    this.label.innerText = getTime(now.valueOf());
    const y = this.airday.transform.timeToY(now);
    this.container.style.top = `${y}px`; // TODO: 50 is dynamic
  }
}

export class AllDayEvents {
  airdayCal: AirdayCal;
  region: HTMLDivElement;
  container: HTMLDivElement;
  expanded = false;
  constructor(airdayCal: AirdayCal) {
    this.airdayCal = airdayCal;
    const region = document.createElement("div");
    region.className = "all-day-area";
    const container = document.createElement("div");
    container.className = "all-day-events";
    region.append(container);
    this.region = region;
    this.container = container;
    return this;
  }
  render(
    dateCache: Map<number, Set<CalendarEvent>>,
    idCache: Map<string, CalendarEvent>,
  ) {
    if (this.expanded) {
      this.renderExpanded(idCache);
    } else {
      this.renderContracted(dateCache);
    }
  }
  // TODO: Layout to be done in a worker
  renderExpanded(cache: Map<string, CalendarEvent>) {
    console.log("render expanded");
    // For each event
    // sort by earliest, then longest.
    // Earliest at the top, then if the next event intersects, place below, create next lane,
    // for next event start at the top and find first lane with no intersection
  }
  // TODO: Layout to be done in a worker
  // TODO: Test the shit out of this function
  renderContracted(cache: Map<number, Set<CalendarEvent>>) {
    console.log("render contracted", cache);
    // We already have counts, we just need to check if there are events WITHOUT intersections
    let curSolo: CalendarEvent | undefined; // current event without intersections
    let curSoloIdx: number | undefined = undefined;
    const toRender: CalendarEvent[] = [];
    const layout: number[] = []; // count, or false
    let idx = 0;
    cache.forEach((vals, key) => {
      layout.push(vals.size);
      if (vals.size === 0 && curSolo) {
        // render this start to finish
        toRender.push(curSolo);
        for (let i = curSoloIdx as number; i < idx; i++) {
          layout[i] = 0;
        }
      }
      if (vals.size === 1) {
        const val = vals.values().next().value as CalendarEvent;
        if (!curSolo) {
          // assign new event
          curSolo = val;
          curSoloIdx = idx;
        }
        if (curSolo && curSolo.id !== val.id) {
          toRender.push(curSolo);
          curSolo = val;
          curSoloIdx = idx;
        }
        if (curSolo && curSolo.id === val.id) {
          // do nothing because it's a continuation
        }
      }
      if (vals.size > 1) {
        curSolo = undefined;
        curSoloIdx = undefined;
      }
      idx++;
    });
    console.log(layout, toRender);
    // TODO: Render these!!
  }
  expand() {
    this.expanded = true;
  }
  collapse() {
    this.expanded = false;
  }
}
