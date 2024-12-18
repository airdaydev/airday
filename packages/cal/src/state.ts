import { CalendarEvent, CalendarEventConstructorProps } from "./event";

export class EventDB {
  idMap = new Map<string, CalendarEvent>();
  constructor() {}
  indexEvent(event: CalendarEvent) {
    // Place in Yearly/Monthly tree index OR?
  }
  loadEvents(sEvents: CalendarEventConstructorProps[]) {
    for (let sEvent of sEvents) {
      const event = new CalendarEvent(sEvent);
      this.indexEvent(event);
      this.idMap.set(event.id, event);
    }
  }
}
