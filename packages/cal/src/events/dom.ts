import { DayLayout, EventLayout } from "./layout";

interface RenderOptions {
  debug?: boolean;
  // highlightId?: string;
  // fadeTs?: number;
}

function EventEl(layout: EventLayout) {
  const div = document.createElement("div");
  div.classList.add("event", layout.color);
  div.style.top = `${layout.y}px`;
  div.style.left = `${layout.x}px`;
  div.style.height = `${layout.height}px`;
  div.style.width = `${layout.width}px`;
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

export function DayEl(layout: DayLayout, xPos: number) {
  // Setup theme
  const dayEl = document.createElement("div");
  dayEl.style.position = "absolute"; // TODO: class based
  dayEl.style.transform = `translate(${xPos}px)`;
  // Create events
  layout.map.forEach((eventLayout) => {
    const el = EventEl(eventLayout);
    dayEl.appendChild(el);
  });
  return dayEl;
}
