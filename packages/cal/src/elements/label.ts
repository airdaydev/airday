import { CalRenderer } from "../render";
import { getDateUTC, isTodayUTC } from "../time";

export function allDayLabel(renderer: CalRenderer) {
  const ctx2D = renderer.ctx2D;
  ctx2D.fillStyle = renderer.colourScheme.color.toString();
  ctx2D.font = "12px Alte Haas Grotesk";
  ctx2D.textAlign = "right";
  ctx2D.textBaseline = "middle";
  ctx2D.fillStyle = renderer.colourScheme.labels.toString();
  ctx2D.fillText(
    "All day",
    renderer.gridOffset[0] - renderer.margin,
    renderer.headerHeight + renderer.allDayRowHeight / 2,
  );
}

export function hzLine(
  renderer: CalRenderer,
  yOffset: number,
  opts: {
    strokeStyle?: string;
    lineWidth?: number;
  } = {},
) {
  const ctx2D = renderer.ctx2D;
  ctx2D.strokeStyle =
    opts.strokeStyle || renderer.colourScheme.hzLine.toString();
  ctx2D.beginPath();
  ctx2D.lineWidth = opts.lineWidth || 1;
  ctx2D.moveTo(renderer.gridOffset[0], yOffset);
  ctx2D.lineTo(renderer.canvas?.offsetWidth, yOffset);
  ctx2D.stroke();
}

export function vtLine(renderer: CalRenderer, xOffset: number, yStart: number) {
  const ctx2D = renderer.ctx2D;
  ctx2D.strokeStyle = renderer.colourScheme.vtLine.toString();
  ctx2D.beginPath();
  ctx2D.lineWidth = 0.75;
  ctx2D.moveTo(xOffset, yStart);
  ctx2D.lineTo(xOffset, renderer.canvas?.offsetHeight);
  ctx2D.stroke();
}

export function dayLabel(renderer: CalRenderer, date: Date, offset: number) {
  const ctx2D = renderer.ctx2D;
  const text = getDateUTC(date);
  ctx2D.textAlign = "left";
  const textWidth = ctx2D.measureText(text).width;
  const padding = (renderer.transform.dayPx - textWidth) / 2;
  if (isTodayUTC(date)) {
    ctx2D.fillStyle = "red";
    ctx2D.roundRect(offset + padding - 4, 14, textWidth + 8, 25, 2);
    ctx2D.fill();
    ctx2D.font = "bold 12px Alte Haas Grotesk";
    ctx2D.fillStyle = "white";
  } else {
    ctx2D.fillStyle = renderer.colourScheme.labels.toString();
    ctx2D.font = "12px Alte Haas Grotesk";
  }
  ctx2D.fillText(text, offset + padding, 25);
}

export function timeNow(renderer: CalRenderer) {
  const ctx2D = renderer.ctx2D;
  const now = new Date();
  const y = renderer.transform.timeToY(now);
  const nowHour = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;
  ctx2D.textAlign = "right";
  ctx2D.textBaseline = "middle";
  ctx2D.font = `${renderer.TIME_FONT_SIZE}px Alte Haas Grotesk`;
  hzLine(renderer, y, { strokeStyle: "#ff0000cc", lineWidth: 0.5 });
  ctx2D.fillStyle = "#ff0000cc";
  ctx2D.fillText(
    `${nowHour.toString()}`,
    renderer.gridOffset[0] - renderer.margin,
    y,
  );
}
