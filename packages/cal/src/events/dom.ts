import { DayLayout, EventLayout } from "./layout";

function EventEl(layout: EventLayout) {
  const div = document.createElement("div");
  div.classList.add("event", layout.color);
  div.style.top = `${layout.y}px`;
  div.style.left = `${layout.x * 100}%`;
  div.style.height = `${layout.height}px`;
  div.style.width = `${layout.width * 100}%`;
  div.style.zIndex = layout.segment.toString();
  if (!layout.startsToday) {
    div.style.borderRadius = "0 0 2px 2px";
  }
  const title = document.createElement("div");
  title.innerText = layout.displayText;
  const time = document.createElement("div");
  time.innerText = layout.displayTime;
  div.append(title, time);
  return div;
}

export function DayEl(
  date: number,
  layout: DayLayout,
  xPos: number,
  dayPx: number,
) {
  // Setup theme
  const dayEl = document.createElement("div");
  dayEl.className = "day";
  dayEl.setAttribute("data-date", date.toString());
  dayEl.style.transform = `translate(${xPos}px)`; // TODO: 2 is a magic number!
  dayEl.style.width = `${dayPx}px`;
  const debugLabel = document.createElement("div");
  debugLabel.className = "date-debug";
  debugLabel.innerText = new Date(date).toUTCString();
  dayEl.appendChild(debugLabel);
  // Create events
  layout.map.forEach((eventLayout) => {
    const el = EventEl(eventLayout);
    dayEl.appendChild(el);
  });
  return dayEl;
}

export function GridEl() {}
