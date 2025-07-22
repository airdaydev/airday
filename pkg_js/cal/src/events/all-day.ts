import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
import { utcZeroDate } from "../time";
import { ExpandedEventLayoutSet } from "./layout";

const defaultExpandedState = false;

export class AllDayEvents {
  airdayCal: AirdayCal;
  container: HTMLDivElement;
  expanded = defaultExpandedState;
  renderedExpanded = defaultExpandedState;
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
  // TODO: Consider using an allDay idCache to access events, rather than passing everything between workers
  renderExpanded(layout: ExpandedEventLayoutSet) {
    this.renderedExpanded = true;
    // render expanded layout
    const divs: HTMLDivElement[] = [];
    layout.forEach((lane, laneIndex) => {
      lane.forEach((event) => {
        const x = this.airdayCal.transform.dateToX(event.startZero);
        const y = laneIndex * 26;
        const div = document.createElement("div");
        div.classList.add("all-day-event", `col_${event.color}`);
        div.style.transform = `translate(${x}px) translateY(${y}px)`;
        div.style.width = `${this.airdayCal.transform.dayPx * event.durationDays - 3}px`; // TODO: We need to actually vary it!
        div.innerText = event.title;
        divs.push(div);
      });
    });
    this.updateRowCount(layout.length);
    this.container.innerHTML = "";
    this.container.append(...divs);
  }
  // TODO: Test the shit out of this function
  // TODO: copy only necessary data
  renderContracted(events: CalendarEvent[], labels: Map<number, number>) {
    this.renderedExpanded = false;
    const divs = events.map((event) => {
      const x = this.airdayCal.transform.dateToX(
        utcZeroDate(event.start).valueOf(),
      );
      const div = document.createElement("div");
      div.classList.add("all-day-event", `col_${event.color}`);
      div.style.transform = `translate(${x}px)`;
      div.style.width = `${this.airdayCal.transform.dayPx * event.dayLength - 3}px`; // TODO: We need to actually vary it!
      div.innerText = event.title;
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
        div.classList.add("all-day-event-count");
        const x = this.airdayCal.transform.dateToX(date.valueOf());
        div.style.transform = `translate(${x}px)`;
        // TODO: Consider slotting these into the day header slot to avoid having to manually assign width
        div.style.width = `${this.airdayCal.transform.dayPx}px`;
        div.innerText = `${count} event${count > 1 ? "s" : ""}`;
        div.addEventListener("click", () =>
          this.airdayCal.allDayEvents?.expand(),
        );
        countDivs.push(div);
      }
    });
    this.container.append(...countDivs);
  }
  expand() {
    this.expanded = true;
    this.airdayCal.act();
  }
  collapse() {
    this.expanded = false;
    this.updateRowCount(1);
    this.airdayCal.act();
  }
}
