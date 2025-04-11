import { DayLayout, EventLayout } from "./layout";

function EventEl(layout: EventLayout) {
  const div = document.createElement("div");
  div.className = "event";
  div.style.top = `${layout.y}px`;
  div.style.color = `white`;
  const title = document.createElement("span");
  title.innerText = layout.displayText;
  const time = document.createElement("span");
  time.innerText = layout.displayTime;
  div.append(title, time);
  return div;
}

export function DayEl(layout: DayLayout, xPos: number) {
  const dayEl = document.createElement("div");
  dayEl.style.position = "absolute"; // TODO: class based
  dayEl.style.left = `${xPos}px`;
  layout.map.forEach((eventLayout) => {
    const el = EventEl(eventLayout);
    dayEl.appendChild(el);
  });
  return dayEl;
}
