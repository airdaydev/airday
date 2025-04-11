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
