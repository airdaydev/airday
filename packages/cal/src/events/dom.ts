import { AirdayCal } from "../cal";
import { DayLayout } from "./layout";

// Code for placing events on DOM (absolute positioning of world space but limited container space)

export class EventsRendererDOM {
  cal: AirdayCal;
  constructor(cal: AirdayCal) {
    this.cal = cal;
  }
  reconcile() {
    // loop through all dates, find dates with stale entries (remove or create)
    // use dayLayouts to re-render days at a time if stale, or consider some sort of dom reconciliation lib... (solid?)
    // TODO: Consider taking or reusing cache from coordinator.ts
    console.log(this.cal.transform.dates, this.cal.transform.startPx);
  }
}
