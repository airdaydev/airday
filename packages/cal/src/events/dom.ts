import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
import { getDateUTC, getTime, isTodayUTC, isWeekend } from "../time";
import { DayLayout, EventLayout } from "./layout";

function EventEl(layout: EventLayout, event: CalendarEvent) {
  const div = document.createElement("div");
  div.classList.add("event", `col_${event.color}`);
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

export function CalHeader() {
  const header = document.createElement("div");
  header.className = "cal-header";
  const dayHeader = document.createElement("div");
  dayHeader.className = "day-header";
  header.appendChild(dayHeader);
  return { header, dayHeader };
}

export function EventsContainer() {
  const container = document.createElement("div");
  container.className = "events-container";
  return container;
}

export function CalHeaderCol(airday: AirdayCal, date: number, xPos: number) {
  const col = document.createElement("div");
  col.style.width = `${airday.transform.dayPx}px`;
  col.className = "cal-header-col";
  col.setAttribute("data-date", date.toString());
  col.style.transform = `translate(${xPos}px)`;
  const jsDate = new Date(date);
  const dateLabel = document.createElement("div");
  dateLabel.className = "date-label";
  const text = getDateUTC(jsDate);
  dateLabel.innerText = text;
  col.appendChild(dateLabel);
  return col;
}

export function appendDayLayout(
  container: HTMLElement,
  layout: DayLayout,
  data: Map<string, CalendarEvent>,
) {
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
  label: HTMLDivElement;
  marker: HTMLDivElement;
  constructor(airday: AirdayCal) {
    this.airday = airday;
    const label = document.createElement("div");
    label.className = "now-label";
    this.label = label;
    const marker = document.createElement("div");
    marker.className = "now-marker";
    this.marker = marker;
    this.update();
    return this;
  }
  update() {
    const now = new Date();
    this.label.innerText = getTime(now.valueOf());
    const y = this.airday.transform.timeToY(now);
    this.label.style.top = `${y}px`; // TODO: 50 is dynamic
    this.marker.style.top = `${y}px`; // TODO: 50 is dynamic
  }
}
