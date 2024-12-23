import { CalendarEvent, CalendarEventConstructorProps } from "./event";
import IntervalTree from "@flatten-js/interval-tree";

export class EventDB {
  idMap = new Map<string, CalendarEvent>();
  intervalTree = new IntervalTree();
  constructor() {}
  indexEvent(event: CalendarEvent) {
    const range = {};
    this.intervalTree.insert([1, 2], event);
  }
  loadEvents(sEvents: CalendarEventConstructorProps[]) {
    for (let sEvent of sEvents) {
      const event = new CalendarEvent(sEvent);
      this.indexEvent(event);
      this.idMap.set(event.id, event);
    }
  }
}
