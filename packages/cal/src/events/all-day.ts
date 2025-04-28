import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
import { getDate, oneDayMs, utcZeroDate } from "../time";

// function incrMapCount(map: Map<number, number>, key: number, val: number) {
//   map.set(key, number);
// }

export class AllDayEvents {
  airdayCal: AirdayCal;
  container: HTMLDivElement;
  expanded = true;
  rows = 1;
  constructor(airdayCal: AirdayCal) {
    this.airdayCal = airdayCal;
    const container = document.createElement("div");
    container.className = "all-day-events";
    this.updateRowCount(1);
    this.container = container;
    return this;
  }
  updateRowCount(count: number) {
    // TODO: Update row count
    this.rows = count || 1; // Ensure minimum is 1, even if no rows in layout
    this.airdayCal.container?.style.setProperty("--rows", this.rows.toFixed());
  }
  renderExpanded(cache: Map<string, CalendarEvent>) {
    const arr = Array.from(cache.values())
      .map((event) => {
        const startZero = utcZeroDate(event.start).valueOf();
        const endZero = utcZeroDate(event.end).valueOf() + oneDayMs;
        const durationDays = (endZero - startZero) / oneDayMs;
        return Object.assign(event, {
          startZero,
          endZero,
          durationDays,
        });
      })
      .sort((a, b) => {
        return a.startZero - b.startZero;
      });
    // how many days
    const layoutMax: number[] = []; // max x per lane
    const layout: any[][] = []; // lane, top to bottom
    arr.forEach((event) => {
      const laneIndex = layoutMax.findIndex(
        (max) => (event.startZero || 0) > max,
      );
      const lane = laneIndex === -1 ? layoutMax.length : laneIndex;
      layoutMax[lane] = event.endZero;
      layout[lane] ? layout[lane].push(event) : (layout[lane] = [event]);
    });
    // render expanded layout
    const divs: HTMLDivElement[] = [];
    console.log(layout);
    layout.forEach((lane, laneIndex) => {
      lane.forEach((event) => {
        const x = this.airdayCal.transform.dateToX(event.startZero);
        const y = laneIndex * 26;
        const div = document.createElement("div");
        div.classList.add("all-day-event", `col_${event.color}`);
        div.style.transform = `translate(${x}px) translateY(${y}px)`;
        div.style.width = `${this.airdayCal.transform.dayPx * event.durationDays - 3}px`; // TODO: We need to actually vary it!
        div.innerText = event.id;
        divs.push(div);
      });
    });
    this.updateRowCount(layout.length);
    this.container.innerHTML = "";
    this.container.append(...divs);
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
      div.style.width = `${this.airdayCal.transform.dayPx * event.dayLength - 3}px`; // TODO: We need to actually vary it!
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
