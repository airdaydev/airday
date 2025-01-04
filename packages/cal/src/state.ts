import { CalendarEvent, CalendarEventConstructorProps } from "./event";
import IntervalTree, { NumericTuple } from "@flatten-js/interval-tree";

export class EventDB {
  idMap = new Map<string, CalendarEvent>();
  tree = new IntervalTree(); // TODO: Split per calendar?
  scene = new Set<CalendarEvent>();
  constructor() {}
  indexEvent(event: CalendarEvent) {
    const range: NumericTuple = [event.start.valueOf(), event.end.valueOf()];
    this.tree.insert(range, event.id);
  }
  loadEvents(sEvents: CalendarEventConstructorProps[]) {
    for (let sEvent of sEvents) {
      const event = new CalendarEvent(sEvent);
      this.indexEvent(event);
      this.idMap.set(event.id, event);
    }
  }
  getEvents(startDate: number, endDate: number) {
    const range: NumericTuple = [startDate, endDate];
    const ids = this.tree.search(range);
    const set: CalendarEvent[] = [];
    ids.forEach((id) => {
      const event = this.idMap.get(id);
      if (event) set.push(event);
    });
    return set;
  }
}
