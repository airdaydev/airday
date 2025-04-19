import { EventSchemes } from "./colours";

export function createCalStyleTag(instanceId: string) {
  const style = document.createElement("style");
  style.id = instanceId;
  style.textContent = `
    #${instanceId} {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
    }
    #${instanceId} .scrollable {
      position: absolute;
      top: 6em;
      left: 0;
      width: 100%;
      height: calc(100% - 6em);
      overflow-y: scroll;
      z-index: 2;
    }
    #${instanceId} .scroll-child {
      position: absolute;
    }
    #${instanceId} .day {
      position: absolute;
      border-right: 1px solid #e1e1e1;
      height: 100%;
    }
    #${instanceId} .event {
      font-size: 10px;
      box-sizing: border-box;
      position: absolute;
      color: white;
      user-select: none;
      border-radius: 4px;
      transition: background 0.05s;
      overflow: hidden;
      padding: 0.25em;
    }
    #${instanceId}.dark .event {
      border: 1px solid #242424;
    }
    #${instanceId}.light .event {
      border: 1px solid #fdfdfd;
    }
    #${instanceId} .debug-date {
      position: sticky;
      top: 0;
      background: yellow;
      opacity: 0.5;
      z-index: 1000;
    }
    #${instanceId} .time-grid-labels {
      position: sticky;
      left: 0;
      width: 36px;
      z-index: 1000;
      font-size: 10px;
      height: 1221px; /* TODO: make dynamic */
      background: white;
    }
    #${instanceId} .time-grid-label {
      position: absolute;
      transform: translateY(-25%);
    }
    #${instanceId} .time-grid-hour {
      position: absolute;
      left: 0;
      height: 1px;
      opacity: 0.2;
      color: black;
      background: white;
    }
    #${instanceId} .time-gridlines {
      position: sticky;
      background: red;
      left: 0;
      z-index: 0;
    }
    #${instanceId} .time-grid-lines {
      position: absolute;
      top: 50px;
      background-color: rgb(119, 119, 119);
      height: 1px;
      width: 100%;
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
