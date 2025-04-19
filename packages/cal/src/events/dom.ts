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
  const gridlines = document.createElement("div");
  gridlines.className = "time-gridlines";

  const labels = document.createElement("div");
  labels.className = "time-grid-labels";

  let pxOffset = 0;
  const now = new Date();
  const y = airdayCal.transform.timeToY(now);

  for (let i = 0; i <= 24; i++) {
    if (i >= 1 && i <= 24) {
      if (Math.abs(pxOffset - y) < airdayCal.TIME_FONT_SIZE) {
        // Hides time if obscured by current hour
      } else {
        const label = document.createElement("div");
        label.className = "time-grid-label";
        label.textContent = `${i.toString().padStart(2, "0")}:00`;
        label.style.right = `${airdayCal.transform.margin}px`;
        label.style.top = `${pxOffset}px`;
        labels.appendChild(label);
      }

      // Horizontal line for the hour
      const hz = document.createElement("div");
      hz.className = "time-grid-lines";
      hz.style.top = `${pxOffset}px`;
      hz.style.backgroundColor = airdayCal.colourScheme.labels.toString();
      gridlines.appendChild(hz);
    }
    pxOffset += airdayCal.transform.hourPx;
  }

  return {
    labels,
    gridlines,
  };
}
