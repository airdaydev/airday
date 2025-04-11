/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import {
  CalSolidWrapper,
  CalendarEventConstructorProps,
  EventDB,
} from "../src/index";
import { createSignal, createUniqueId } from "solid-js";
import { Pane } from "tweakpane";
import Stats from "stats.js";
import { Theme } from "../src/colours";

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

const root = document.getElementById("root");

const theme = createSignal<Theme>("dark");

function randomTitle() {
  return [
    "Provisional riders license test",
    "Cirque Du Soleil Sydney",
    "Mudgee holiday",
  ][Math.floor(Math.random() * 3)];
}

const duration = [15, 60, 120];

function getDuration() {
  return duration[Math.floor(Math.random() * duration.length)] * 1000 * 60;
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
    const duration = getDuration();
    const color = Math.random() > 0.5 ? "blue" : "yellow";
    const date = new Date(roundedRandom);
    date.setSeconds(0);
    date.setMilliseconds(0);
    events.push({
      id: createUniqueId(),
      title: randomTitle(),
      start: date,
      end: new Date(date.valueOf() + duration),
      allDay: false,
      color,
    });
  }
  return events;
}

const start = new Date(new Date().setDate(new Date().getDate() - 365));
const events = dummyEvents(start, 365 * 2, 20000);

const db = new EventDB();
db.loadEvents(events);

render(
  () => (
    <div
      id="app-container"
      style={{
        background: theme[0]() === "dark" ? "rgba(20, 20, 21, 1)" : "white",
      }}
    >
      <h1>@airday/cal demo</h1>
      <CalSolidWrapper theme={theme[0]} db={db} stats={stats} />
    </div>
  ),
  root!,
);

class modifierPane {
  id: string;
  pane?: Pane;
  constructor(id: string) {
    this.id = id;
  }
  init() {
    this.pane = new Pane();
    const folder = this.pane.addFolder({
      title: "@airday/cal",
      expanded: true,
    });
    folder.addBinding(this, "theme", {
      label: "Theme",
      options: {
        dark: "dark",
        light: "light",
      },
    });
  }
  get theme() {
    return theme[0]();
  }
  set theme(themeStr: "dark" | "light") {
    theme[1](() => themeStr);
  }
}

const pane = new modifierPane("Calendar");
pane.init();
