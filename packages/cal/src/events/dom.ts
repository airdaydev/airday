import { AirdayCal } from "../cal";
import { getDateUTC } from "../time";
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
  if (layout.startsToday) {
    const title = document.createElement("div");
    title.innerText = layout.displayText;
    const time = document.createElement("div");
    time.innerText = layout.displayTime;
    div.append(title, time);
  }
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
  // Date label
  const dateLabel = document.createElement("div");
  dateLabel.className = "date-label";
  const text = getDateUTC(new Date(date));
  dateLabel.innerText = text;
  dayEl.appendChild(dateLabel);
  // Debug label
  const debugLabel = document.createElement("div");
  debugLabel.className = "debug-date";
  debugLabel.innerText = new Date(date).toUTCString();
  dayEl.appendChild(debugLabel);
  // Event container
  const dayEvents = document.createElement("div");
  dayEvents.className = "day-events";
  dayEl.appendChild(dayEvents);
  // Create events
  layout.map.forEach((eventLayout) => {
    const el = EventEl(eventLayout);
    dayEvents.appendChild(el);
  });
  return dayEl;
}

export function AllDayLabelEl() {
  const label = document.createElement("div");
  label.className = "all-day-label";
  label.innerText = "All Day";
  return label;
}

export function TimesEl(airdayCal: AirdayCal) {
  const gridlines = document.createElement("div");
  gridlines.className = "time-gridlines";

  const labels = document.createElement("div");
  labels.className = "time-label-col";

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
      gridlines.appendChild(hz);
    }
    pxOffset += airdayCal.transform.hourPx;
  }

  return {
    labels,
    gridlines,
  };
}
