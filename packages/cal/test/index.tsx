/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import { Cal, CalendarEvent } from "../src/index";
import { createSignal, createUniqueId } from "solid-js";

const root = document.getElementById("root");

function dummyEvents(startDate: Date, days = 14, n = 100) {
  const zeroStartDate = new Date(startDate);
  const endDate = new Date(zeroStartDate);
  endDate.setDate(zeroStartDate.getDate() + days);
  const events: CalendarEvent[] = [];
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
      label: "test",
      start: new Date(date),
      end: new Date(date.valueOf() + duration),
    });
  }
  return events;
}

const oneWeekAgo = new Date(new Date().setDate(new Date().getDate() - 7));
const oneWeekFromNow = new Date(new Date().setDate(new Date().getDate() + 7));

const events = createSignal(dummyEvents(oneWeekAgo));

render(
  () => (
    <div id="app-container">
      <h1>@airday/cal demo</h1>
      <Cal events={events} />
    </div>
  ),
  root!,
);
