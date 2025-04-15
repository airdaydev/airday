import {
  darkScheme,
  lightScheme,
  darkEventSchemes,
  lightEventSchemes,
  Theme,
} from "../colours";
import { DayLayout, EventLayout } from "./layout";

interface RenderOptions {
  theme?: Theme;
  debug?: boolean;
  // highlightId?: string;
  // fadeTs?: number;
}

function EventEl(layout: EventLayout) {
  const div = document.createElement("div");
  div.classList = `event ${layout.color}`;
  div.style.top = `${layout.y}px`;
  div.style.left = `${layout.x}px`;
  div.style.height = `${layout.height}px`;
  div.style.width = `${layout.width}px`;
  if (!layout.startsToday) {
    div.style.borderRadius = "0 0 2px 2px";
  }
  const title = document.createElement("span");
  title.innerText = layout.displayText;
  const time = document.createElement("span");
  time.innerText = layout.displayTime;
  div.append(title, time);
  return div;
}

// TODO: Create as CSS
function parseColourScheme(colour: any): "yellow" | "blue" {
  if (typeof colour !== "string") return "blue";
  if (colour !== "blue" && colour !== "yellow") return "blue";
  return colour;
}

export function DayEl(
  layout: DayLayout,
  xPos: number,
  renderOpts: RenderOptions = {},
) {
  // Setup theme
  const theme = renderOpts.theme || "dark";
  const globalScheme = theme === "light" ? lightScheme : darkScheme;
  const colourScheme = theme === "light" ? lightEventSchemes : darkEventSchemes;
  // Create container
  const dayEl = document.createElement("div");
  dayEl.style.position = "absolute"; // TODO: class based
  dayEl.style.left = `${xPos}px`;
  // Create events
  layout.map.forEach((eventLayout) => {
    const scheme = colourScheme[parseColourScheme(eventLayout.color)];
    const el = EventEl(eventLayout);
    dayEl.appendChild(el);
  });
  return dayEl;
}
