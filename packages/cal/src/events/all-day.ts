import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
import { getDate, utcZeroDate } from "../time";

// function incrMapCount(map: Map<number, number>, key: number, val: number) {
//   map.set(key, number);
// }

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
    console.log("rendering expanded");
    // For each event
    // sort by earliest, then longest.
    // Earliest at the top, then if the next event intersects, place below, create next lane,
    // for next event start at the top and find first lane with no intersection
  }
  // TODO: Layout to be done in a worker
  // TODO: Test the shit out of this function
  // TODO: copy only necessary data
  renderContracted(cache: Map<number, Set<CalendarEvent>>) {
    console.log("rendering contracted");
    let trackedEvent: CalendarEvent | undefined; // Event we're looking at
    let trackedEventDates: number[] = []; // Each day that tracked event spans
    const toRender: (CalendarEvent & { dayLength: number })[] = []; // Each calendar event to render in full
    const layout = new Map<number, number>(); // date, event count to display (0 = no display)

    // Loop through dates
    this.airdayCal.transform.dates.forEach((date) => {
      const dateVal = date.valueOf();
      const dateCache = cache.get(dateVal); // get date val
      const size = dateCache?.size || 0; // amount of events on each date
      layout.set(dateVal, size); // Assume that all dates have sizes, then removed when we replace with an event

      // Case 1: next date has no events, but there is an event tracked
      // No intersections, render this date & clear dates tracked so far
      if (size === 0 && trackedEvent) {
        toRender.push(
          Object.assign(trackedEvent, {
            dayLength: trackedEventDates.length,
          }),
        );
        trackedEvent = undefined;
        trackedEventDates.forEach((d) => {
          layout.set(d, 0);
        });
        trackedEventDates = [];
      }
      if (size === 1) {
        // no intersection possible
        const val = dateCache.values().next().value as CalendarEvent;
        // Case 2: next date has 1 event, the tracked event, continue and store date
        if (trackedEvent && trackedEvent.id === val.id) {
          trackedEventDates.push(dateVal);
        }
        // Case 3: next date has 1 event, not the tracked event, render & start with swapped event
        // Note we can be sure that the event started today, as it would have intersected with an event previously
        if (trackedEvent && trackedEvent.id !== val.id) {
          toRender.push(
            Object.assign(trackedEvent, {
              dayLength: trackedEventDates.length,
            }),
          );
          trackedEventDates.forEach((d) => {
            layout.set(d, 0);
          });
          trackedEvent = val;
          trackedEventDates = [dateVal];
        }
        // Case 4: No tracked event
        // Case 4: One event; we start tracking it, if it started today
        if (
          !trackedEvent &&
          utcZeroDate(val.start).valueOf() === date.valueOf()
        ) {
          trackedEvent = val;
          trackedEventDates.forEach((d) => {
            layout.set(d, 0);
          });
          trackedEventDates = [dateVal];
        }
      }
      // Case 5: next date has multiple events - INTERSECTION
      if (size > 1) {
        // More than one date = reset
        trackedEvent = undefined;
        trackedEventDates = [];
      }
    });
    const divs = toRender.map((event) => {
      const x = this.airdayCal.transform.dateToX(
        utcZeroDate(event.start).valueOf(),
      );
      const div = document.createElement("div");
      div.classList.add("all-day-event", `col_${event.color}`);
      div.style.transform = `translate(${x}px)`;
      div.style.width = `${this.airdayCal.transform.dayPx * event.dayLength}px`; // TODO: We need to actually vary it!
      div.innerText = event.id;
      return div;
    });
    // Render events:
    // TODO: Track dom refs & remove as needed
    this.container.innerHTML = "";
    this.container.append(...divs);
    // TODO: Render event qties:
    const countDivs: HTMLDivElement[] = [];
    this.airdayCal.transform.dates.forEach((date) => {
      const count = layout.get(date.valueOf());
      if (count) {
        const div = document.createElement("div");
        div.classList.add("all-day-event");
        const x = this.airdayCal.transform.dateToX(date.valueOf());
        div.style.transform = `translate(${x}px)`;
        div.innerText = `${count} event${count > 1 ? "s" : ""}`;
        countDivs.push(div);
      }
    });
    this.container.append(...countDivs);
  }
  expand() {
    this.expanded = true;
  }
  collapse() {
    this.expanded = false;
  }
}
