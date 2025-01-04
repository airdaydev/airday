import { useContext, createUniqueId } from "solid-js";
import { sessionContext } from "../store/context";
import { DataView } from "../view/state";
import { CalendarHeader } from "../list/list-header";
import {
  CalSolidWrapper,
  EventDB,
  CalendarEventConstructorProps,
} from "@airday/cal";
import { theme } from "../theme/theme";

function randomTitle() {
  return [
    "Provisional riders license test",
    "Cirque Du Soleil Sydney",
    "Mudgee holiday",
  ][Math.floor(Math.random() * 5)];
}

function dummyEvents(startDate: Date, days = 14, n = 100) {
  const zeroStartDate = new Date(startDate);
  const endDate = new Date(zeroStartDate);
  endDate.setDate(zeroStartDate.getDate() + days);
  const events: CalendarEventConstructorProps[] = [];
  const range = endDate.valueOf() - zeroStartDate.valueOf();
  for (let i = 0; i < n; i++) {
    const random = Math.random() * range;
    const r = random % 15;
    const roundedRandom = random - r + zeroStartDate.valueOf();
    const duration = (Math.random() > 0.5 ? 15 : 60) * 1000 * 60;
    const date = new Date(roundedRandom);
    date.setSeconds(0);
    date.setMilliseconds(0);
    events.push({
      id: createUniqueId(),
      title: randomTitle(),
      start: new Date(date),
      end: new Date(date.valueOf() + duration),
      allDay: false,
    });
  }
  return events;
}

const start = new Date(new Date().setDate(new Date().getDate() - 182));
const events = dummyEvents(start, 365, 20000);

const db = new EventDB();
db.loadEvents(events);

/**
 * Initially, a weekly view.
 */
export const Calendar = (props: { view: DataView }) => {
  const session = useContext(sessionContext);
  return (
    <div style="display: flex; flex-direction: column; width: 100%; height: 100%;">
      <CalendarHeader view={props.view} />
      <CalSolidWrapper theme={theme[0]} db={db} />
    </div>
  );
};
