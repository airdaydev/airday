import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
import { utcMidnight } from "../time";

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
    // console.log(layout, toRender);
    const divs = toRender.map((event) => {
      const x = this.airdayCal.transform.dateToX(utcMidnight(event.start));
      const div = document.createElement("div");
      div.className = "all-day-event";
      div.style.transform = `translate(${x}px)`;
      div.style.width = `${this.airdayCal.transform.dayPx * 2 - 2}px`; // TODO: We need to actually vary it!
      div.innerText = event.title;
      return div;
    });
    this.container.append(...divs);
    // TODO: Render these!!
  }
  expand() {
    this.expanded = true;
  }
  collapse() {
    this.expanded = false;
  }
}
