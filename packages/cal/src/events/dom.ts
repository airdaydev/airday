import { AirdayCal } from "../cal";
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
  airday: AirdayCal,
  date: number,
  layout: DayLayout,
  xPos: number,
) {
  // Setup theme
  const dayEl = document.createElement("div");
  dayEl.className = "day";
  dayEl.setAttribute("data-date", date.toString());
  dayEl.style.transform = `translate(${xPos}px)`;
  dayEl.style.width = `${airday.transform.dayPx}px`;
  const debugLabel = document.createElement("div");
  debugLabel.className = "debug-date";
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

export function TimesEl(airdayCal: AirdayCal) {
  const timesContainer = document.createElement("div");
  timesContainer.className = "time-grid";
  timesContainer.style.position = "sticky";
  timesContainer.style.left = "0";
  timesContainer.style.width = `24px`;
  timesContainer.style.height = `100%`;
  timesContainer.style.overflow = "hidden";

  let pxOffset = 0;
  const now = new Date();
  const y = airdayCal.transform.timeToY(now);

  for (let i = 0; i <= 24; i++) {
    if (i >= 1 && i <= 24) {
      if (Math.abs(pxOffset - y) < airdayCal.TIME_FONT_SIZE) {
        // Hides time if obscured by current hour
      } else {
        const timeLabel = document.createElement("div");
        timeLabel.className = "time-grid-label";
        timeLabel.textContent = `${i.toString().padStart(2, "0")}:00`;
        timeLabel.style.right = `${airdayCal.transform.margin}px`;
        timeLabel.style.top = `${pxOffset}px`;
        timesContainer.appendChild(timeLabel);
      }

      // Horizontal line for the hour
      const hourLine = document.createElement("div");
      hourLine.className = "time-grid-hour";
      hourLine.style.top = `${pxOffset}px`;
      hourLine.style.backgroundColor = airdayCal.colourScheme.labels.toString();
      timesContainer.appendChild(hourLine);
    }
    pxOffset += airdayCal.transform.hourPx;
  }

  return timesContainer;
}
