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
  getEvents(startDate: Date, endDate: Date) {
    const range: NumericTuple = [startDate.valueOf(), endDate.valueOf()];
    const ids = this.tree.search(range);
    const arr: CalendarEvent[] = [];
    ids.forEach((id) => {
      const event = this.idMap.get(id);
      if (event) arr.push(event);
    });
    return arr;
  }
}

function startOfDay(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

// Rendering cache for events
// Must test if any event intersects on that day
export class eventCache {
  map = new Map<string, any>();
  addEvent(event: CalendarEvent) {}
  renderDay(clipMin, clipEnd) {}
}

export function eventsToDateMap(
  arr: CalendarEvent[],
  startDate: number,
  endDate: number,
) {
  const map = new Map<Date, Set<CalendarEvent>>();
  arr.forEach((event) => {
    // change to ternaries
    let min = startDate;
    const eventStartDay = startOfDay(event.start);
    if (eventStartDay.valueOf() > startDate) {
      min = eventStartDay.valueOf();
    }
    let max = endDate;
    const eventEndDay = startOfDay(event.end);
    if (eventEndDay.valueOf() > endDate) {
      max = eventEndDay.valueOf();
    }
    let cur = min;
    while (cur < max) {
      const curDate = new Date(cur);
      const d = map.get(curDate);
      if (!d) {
        map.set(curDate, new Set([event]));
      } else {
        d.add(event);
      }
      cur += 864e5;
    }
  });
  return map;
}
