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
  renderExpanded(cache: Map<string, CalendarEvent>) {
    console.log("rendering expanded");
    // For each event
    // sort by earliest, then longest.
    // Earliest at the top, then if the next event intersects, place below, create next lane,
    // for next event start at the top and find first lane with no intersection
  }
  // TODO: Test the shit out of this function
  // TODO: copy only necessary data
  renderContracted(events: [], labels: Map<number, number>) {
    const divs = events.map((event) => {
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
    this.container.innerHTML = "";
    this.container.append(...divs);
    const countDivs: HTMLDivElement[] = [];
    this.airdayCal.transform.dates.forEach((date) => {
      const count = labels.get(date.valueOf());
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
