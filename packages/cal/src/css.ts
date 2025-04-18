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
    #${instanceId} .day {
      position: absolute;
    }
    #${instanceId} .event {
      font-family: 'Alte Haas Grotesk';
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
      background: yellow;
      opacity: 0.5;
      position: relative;
      z-index: 1000;
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
