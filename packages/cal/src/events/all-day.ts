import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
import { utcMidnight } from "../time";

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
    console.log("rendering contracted", cache);
    // We already have counts, we just need to check if there are events WITHOUT intersections
    let curSolo: CalendarEvent | undefined; // current event without intersections
    let curSoloDates: number[] = [];
    const toRender: (CalendarEvent & { dayLength: number })[] = [];
    const layout = new Map<number, number>(); // date, event count to display (0 = no display)
    let idx = 0;
    cache.forEach((vals, key) => {
      layout.set(key, vals.size);
      if (vals.size === 0 && curSolo) {
        // render this start to finish
        toRender.push(
          Object.assign(curSolo, { dayLength: curSoloDates.length }),
        );
        curSoloDates.forEach((date) => {
          layout.delete(date);
        });
      }
      if (vals.size === 1) {
        const val = vals.values().next().value as CalendarEvent;
        if (!curSolo) {
          // assign new event
          curSolo = val;
          curSoloDates = [key];
        }
        if (curSolo && curSolo.id !== val.id) {
          toRender.push(
            Object.assign(curSolo, { dayLength: curSoloDates.length }),
          );
          curSolo = val;
          curSoloDates = [key];
        }
        if (curSolo && curSolo.id === val.id) {
          curSoloDates.push(key);
        }
      }
      if (vals.size > 1) {
        // More than one date = reset
        curSolo = undefined;
        curSoloDates = [];
      }
      idx++;
    });
    // console.log(layout, toRender);
    const divs = toRender.map((event) => {
      const x = this.airdayCal.transform.dateToX(utcMidnight(event.start));
      const div = document.createElement("div");
      div.classList.add("all-day-event", `col_${event.color}`);
      div.style.transform = `translate(${x}px)`;
      div.style.width = `${this.airdayCal.transform.dayPx * event.dayLength - 2}px`; // TODO: We need to actually vary it!
      div.innerText = event.title;
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
