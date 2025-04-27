import { EventSchemes } from "./colours";

const ALL_DAY_MARGIN = 50;

export function createCalStyleTag(instanceId: string) {
  const style = document.createElement("style");
  style.id = instanceId;
  style.textContent = `
    :root {
      --black: #121212;
      --white: #ffffff;
    }
    #${instanceId} {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      font-size: 11px;
    }
    #${instanceId}.light {
      color: #5c5c5c;
      background: var(--white);
    }
    #${instanceId}.dark {
      color: #a0a0a0;
      background: var(--black);
    }
    #${instanceId} .events-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    #${instanceId} .scrollable {
      position: absolute;
      left: 0;
      width: 100%;
      height: 100%;
      overflow-y: scroll;
      z-index: 2;
    }
    #${instanceId} .scroll-child {
      position: absolute;
      top: 0;
      left: 0;
    }
    #${instanceId} .day {
      position: absolute;
      height: 100%;
    }
    #${instanceId}.light .day.weekend {
      background-color: #fbfbfb;
    }
    #${instanceId}.dark .day.weekend {
      background-color: #0f0f0f;
    }
    #${instanceId} .event {
      box-sizing: border-box;
      position: absolute;
      user-select: none;
      -webkit-user-select: none;
      cursor: default;
      border-radius: 4px;
      transition: background 0.05s;
      overflow: hidden;
      padding: 0.25em;
    }
    #${instanceId}.dark .event {
      border: 1px solid var(--black);
    }
    #${instanceId}.light .event {
      border: 1px solid var(--white);
    }
    #${instanceId} .day-header {
      position: sticky;
      top: -0.5px; /* covers top of scroll container as items that scroll up show in a gap - maybe related to sticky positioning */
      width: 100%;
      z-index: 10;
    }
    #${instanceId} .all-day {
      height: 25px;
    }
    #${instanceId}.light .all-day {
      background: var(--white);
      border-top: 1px solid #f0f0f0;
      border-right: 1px solid #f0f0f0;
      border-bottom: 1px solid #f0f0f0;
    }
    #${instanceId}.dark .all-day {
        background: var(--black);
        border-top: 1px solid #222;
        border-right: 1px solid #222;
        border-bottom: 1px solid #222;
    }
    #${instanceId} .date-label {
      display: flex;
      text-align: center;
      user-select: none;
      -webkit-user-select: none;
      cursor: default;
      height: 24px;
      align-items: center;
      justify-content: center;
    }
    #${instanceId} .debug-date {
      display: none;
      position: sticky;
      top: 0;
      background: yellow;
      opacity: 0.5;
      z-index: 10;
    }
    #${instanceId} .time-label-col {
      position: sticky;
      left: 0;
      width: 50px;
      z-index: 10;
      font-size: 10px;
      height: 1221px; /* TODO: make dynamic */
      text-align: center;
      box-sizing: content-box;
      user-select: none;
      -webkit-user-select: none;
      cursor: default;
    }
    #${instanceId} .time-grid-label {
      position: absolute;
      transform: translateY(-50%);
    }
    #${instanceId} .time-grid-hour {
      position: absolute;
      left: 0;
      height: 1px;
      opacity: 0.2;
      background: white;
    }
    #${instanceId} .time-gridlines {
      position: absolute;
      top: ${ALL_DAY_MARGIN}px;
      left: 0;
      z-index: 0;
      height: 100%;
      width: 100%;
    }
    #${instanceId} .time-grid-lines {
      position: absolute;
      height: 1px;
      width: 100%;
      user-select: none;
      -webkit-user-select: none;
      pointer-events: none;
    }
    #${instanceId}.light .time-grid-lines {
      background-color: #f0f0f0;
    }
    #${instanceId}.dark .time-grid-lines {
      background-color: #222;
    }
    #${instanceId} .day-events {
      position: absolute;
      width: 100%;
      height: 100%;
      top: ${ALL_DAY_MARGIN}px;
      z-index: 2;
      box-sizing: border-box;
      overflow-x: hidden; /* TODO: Debug later but this is creating scrollbars even with it set to visible */
      overflow-y: hidden;
    }
    #${instanceId}.light .day-events {
      border-right: 1px solid #e1e1e1;
    }
    #${instanceId}.dark .day-events {
      border-right: 1px solid #363636;
    }
    #${instanceId}.light .time-label-col {
      background: var(--white);
    }
    #${instanceId}.dark .time-label-col {
      background: var(--black);
    }
    #${instanceId}.light .date-label {
      background: var(--white);
    }
    #${instanceId}.dark .date-label {
      background: var(--black);
    }
    #${instanceId} .top-left-anchor {
      top: 0;
      left: 0;
      position: sticky;
      background: white;
      z-index: 20;
      height: ${ALL_DAY_MARGIN}px;
      width: 50px;
      font-size: 10px;
      white-space: nowrap;
    }
    #${instanceId}.light .top-left-anchor {
      background: var(--white);
    }
    #${instanceId}.dark .top-left-anchor {
      background: var(--black);
    }
    #${instanceId} .event-title {
      word-break: break-word;
      hyphens: auto;
      font-weight: 500;
    }
    #${instanceId} .event-time {
      font-family: monospace;
    }
    #${instanceId} .tz-button {
      width: 100%;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #${instanceId} .all-day-label {
      width: 100%;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #${instanceId} .cal-header {
      position: sticky;
      width: 100%;
      z-index: 10;
      top: 0;
      height: 50px;
      background: white;
    }
    #${instanceId} .all-day-events {
      position: absolute;
      height: 28px;
      width: 100%;
      z-index: 10;
      top: 24px;
    }
    #${instanceId} .all-day-event {
      position: absolute;
      height: 25px;
      top: 1px;
      left: 1px;
      border-radius: 3px;
      display: flex;
      align-items: center;
      padding-left: 0.5em;
      box-sizing: border-box;
      user-select: none;
      -webkit-user-select: none;
      cursor: default;
    }
    #${instanceId} .now-container {
      position: absolute;
      width: 100%;
      pointer-events: none;
    }
    #${instanceId} .now-marker {
      position: absolute;
      left: 0;
      width: 100%;
      z-index: 10;
      height: 1px;
      background: #ff8a8a;
      margin-top: 50px;
    }
    #${instanceId} .now-label {
      position: absolute;
      z-index: 13;
      right: 10px;
      color: #ff7878;
      transform: translateY(-50%);
      font-weight: 600;
    }
    #${instanceId} .today .day-header {
      font-weight: 600;
      color: #ff7878;
    }
    #${instanceId} .day-header {
      height: 50px;
      background: red;
    }
    #${instanceId} .cal-header-col {
      position: absolute;
    }
  `;
  document.head.appendChild(style);
  return style;
}

export function createColoursStyleTag(
  instanceId: string,
  lightScheme: EventSchemes,
  darkScheme: EventSchemes,
) {
  const style = document.createElement("style");
  style.id = `${instanceId}-colours`;
  let eventColoursCSS = "";
  for (let key of Object.keys(lightScheme)) {
    let scheme = lightScheme[key as keyof EventSchemes];
    eventColoursCSS = eventColoursCSS.concat(`#${instanceId}.light .col_${key} {
      background: ${scheme.bg};
      color: ${scheme.text};
    }  #${instanceId}.light .col_${key}:hover { background: ${scheme.fg} }`);
  }
  for (let key of Object.keys(darkScheme)) {
    let scheme = darkScheme[key as keyof EventSchemes];
    eventColoursCSS = eventColoursCSS.concat(`#${instanceId}.dark .col_${key} {
      background: ${scheme.bg};
      color: ${scheme.text};
    } #${instanceId}.dark .col_${key}:hover { background: ${scheme.fg} }`);
  }
  style.textContent = eventColoursCSS;
  document.head.appendChild(style);
  return style;
}
