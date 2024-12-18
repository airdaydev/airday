import { CalendarEvent, CalendarEventConstructorProps } from "./event";

export class EventDB {
  constructor() {}
  indexEvent(event: CalendarEvent) {
    // Place in Yearly/Monthly/Daily tree index
  }
  loadEvents(sEvents: CalendarEventConstructorProps[]) {
    for (let sEvent of sEvents) {
      const event = new CalendarEvent(sEvent);
      this.indexEvent(event);
    }
  }
}
