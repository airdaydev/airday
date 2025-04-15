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
    #${instanceId} .event {
      font-family: 'Alte Haas Grotesk';
      font-size: 10px;
      position: absolute;
      color: white;
      user-select: none;
      border-radius: 2px;
      transition: background 0.05s;
      overflow: hidden;
    }
    #${instanceId} .event:hover {
      background: lightgray !important;
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
    }`);
  }
  for (let key of Object.keys(darkScheme)) {
    let scheme = darkScheme[key as keyof EventSchemes];
    eventColoursCSS =
      eventColoursCSS.concat(`#${instanceId}.dark .event.${key} {
      background: ${scheme.bg};
      color: ${scheme.text};
    }`);
  }
  style.textContent = eventColoursCSS;
  document.head.appendChild(style);
  return style;
}
