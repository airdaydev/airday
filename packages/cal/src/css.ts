import { EventSchemes } from "./colours";

const ALL_DAY_MARGIN = 28;

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
      font-size: 12px;
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
    #${instanceId} .event {
      font-size: 10px;
      box-sizing: border-box;
      position: absolute;
      user-select: none;
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
    #${instanceId} .date-label {
      position: sticky;
      top: -0.5px; /* covers top of scroll container as items that scroll up show in a gap - maybe related to sticky positioning */
      width: calc(100% + 1px); /* similar to top val, ensuring no gap on either side */
      z-index: 10;
      padding: 0.5em 0;
      text-align: center;
      user-select: none;
      -webkit-user-select: none;
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
      width: 36px;
      z-index: 10;
      font-size: 10px;
      height: 1221px; /* TODO: make dynamic */
      text-align: center;
      box-sizing: content-box;
      padding: 0 4px;
      user-select: none;
      -webkit-user-select: none;
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
      position: sticky;
      left: 0;
      z-index: 0;
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
      background-color: #e1e1e1;
    }
    #${instanceId}.dark .time-grid-lines {
      background-color: #222;
    }
    #${instanceId} .day-events {
      width: 100%;
      height: 100%;
      position: relative;
      top: ${ALL_DAY_MARGIN}px;
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
      height: 54px;
      width: fit-content;
      font-size: 10px;
      padding: 0 0.5em;
    }
    #${instanceId} .event-title {
      font-weight: 500;
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
    eventColoursCSS =
      eventColoursCSS.concat(`#${instanceId}.light .event.${key} {
      background: ${scheme.bg};
      color: ${scheme.text};
    }  #${instanceId}.light .event.${key}:hover { background: ${scheme.fg} }`);
  }
  for (let key of Object.keys(darkScheme)) {
    let scheme = darkScheme[key as keyof EventSchemes];
    eventColoursCSS =
      eventColoursCSS.concat(`#${instanceId}.dark .event.${key} {
      background: ${scheme.bg};
      color: ${scheme.text};
    } #${instanceId}.dark .event.${key}:hover { background: ${scheme.fg} }`);
  }
  style.textContent = eventColoursCSS;
  document.head.appendChild(style);
  return style;
}
