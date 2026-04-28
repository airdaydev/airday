import { CalendarEvent, CalendarEventConstructorProps } from "./model";
import IntervalTree, { NumericTuple } from "@flatten-js/interval-tree";

export class EventDB {
  idMap = new Map<string, CalendarEvent>();
  tree = new IntervalTree();
  ready = false; // Currently manually controlled
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
  getEvents(startDate: Date, endDate: Date) {
    const range: NumericTuple = [startDate.valueOf(), endDate.valueOf()];
    const ids = this.tree.search(range);
    const arr: CalendarEvent[] = [];
    // console.log(
    //   startDate,
    //   ids,
    //   ids.map((id) => this.idMap.get(id)),
    // );
    ids.forEach((id) => {
      const event = this.idMap.get(id);
      if (event) arr.push(event);
    });
    return arr;
  }
}
