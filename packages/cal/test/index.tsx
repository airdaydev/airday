/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import {
  CalSolidWrapper,
  CalendarEventConstructorProps,
  EventDB,
} from "../src/index";
import { createSignal, createUniqueId } from "solid-js";
import * as dat from "dat.gui";

const root = document.getElementById("root");

const theme = createSignal<"dark" | "light">("dark");

function randomTitle() {
  return [
    "Provisional riders license test",
    "Cirque Du Soleil Sydney",
    "Mudgee holiday",
  ][Math.floor(Math.random() * 3)];
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
    const duration = (Math.random() > 0.5 ? 120 : 240) * 300 * 60;
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

const start = new Date(new Date().setDate(new Date().getDate() - 365));
const events = dummyEvents(start, 365 * 2, 10000);

const db = new EventDB();
db.loadEvents(events);

render(
  () => (
    <div
      id="app-container"
      style={{ background: theme[0]() === "dark" ? "black" : "white" }}
    >
      <h1>@airday/cal demo</h1>
      <CalSolidWrapper theme={theme[0]} db={db} />
    </div>
  ),
  root!,
);

class guiModifier {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
  toggleDarkMode() {
    theme[1]((v) => (v === "light" ? "dark" : "light"));
  }
  gui = (gui: dat.GUI) => {
    const folder = gui.addFolder(this.id);
    folder.add(this, "toggleDarkMode").name("Toggle dark mode");
    folder.open();
  };
}

const gui = new dat.GUI();
(document.querySelector(".dg.ac") as HTMLElement).style.zIndex = "10";
// const contextFolder = gui.addFolder("Context");
// contextFolder.open();
// contextFolder
//   .add(context, "mode", {
//     ["Custom Drag"]: "custom",
//     ["HTML Native Drag"]: "native",
//   })
//   .name("Drag Mode")
//   .onChange((value) => {
//     switch (value) {
//       case "native":
//         dndContext.mode[1]("native");
//         break;
//       case "custom":
//         dndContext.mode[1]("custom");
//         break;
//       default:
//     }
//   });

const guiA = new guiModifier("Calendar");

guiA.gui(gui);
