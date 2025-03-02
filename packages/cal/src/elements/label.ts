import { AirdayCal } from "../cal";
import { getDateUTC, isTodayUTC } from "../time";

export function allDayLabel(airdayCal: AirdayCal) {
  const ctx2D = airdayCal.ctx2D;
  ctx2D.fillStyle = airdayCal.colourScheme.color.toString();
  ctx2D.font = "12px Alte Haas Grotesk";
  ctx2D.textAlign = "right";
  ctx2D.textBaseline = "middle";
  ctx2D.fillStyle = airdayCal.colourScheme.labels.toString();
  ctx2D.fillText(
    "All day",
    airdayCal.transform.gridOffset[0] - airdayCal.transform.margin,
    airdayCal.transform.headerHeight + airdayCal.transform.allDayRowHeight / 2,
  );
}

export function hzLine(
  airdayCal: AirdayCal,
  yOffset: number,
  opts: {
    strokeStyle?: string;
    lineWidth?: number;
  } = {},
) {
  const ctx2D = airdayCal.ctx2D;
  ctx2D.strokeStyle =
    opts.strokeStyle || airdayCal.colourScheme.hzLine.toString();
  ctx2D.beginPath();
  ctx2D.lineWidth = opts.lineWidth || 1;
  ctx2D.moveTo(airdayCal.transform.gridOffset[0], yOffset);
  ctx2D.lineTo(airdayCal.canvas?.offsetWidth, yOffset);
  ctx2D.stroke();
}

export function vtLine(airdayCal: AirdayCal, xOffset: number, yStart: number) {
  const ctx2D = airdayCal.ctx2D;
  ctx2D.strokeStyle = airdayCal.colourScheme.vtLine.toString();
  ctx2D.beginPath();
  ctx2D.lineWidth = 0.75;
  ctx2D.moveTo(xOffset, yStart);
  ctx2D.lineTo(xOffset, airdayCal.canvas?.offsetHeight);
  ctx2D.stroke();
}

export function dayLabel(airdayCal: AirdayCal, date: Date, offset: number) {
  const ctx2D = airdayCal.ctx2D;
  const text = getDateUTC(date);
  const nowCol = airdayCal.colourScheme.now.toString();
  ctx2D.textAlign = "left";
  const textWidth = ctx2D.measureText(text).width;
  const padding = (airdayCal.transform.dayPx - textWidth) / 2;
  if (isTodayUTC(date)) {
    ctx2D.fillStyle = nowCol;
    ctx2D.roundRect(offset + padding - 4, 14, textWidth + 8, 25, 2);
    ctx2D.fill();
    ctx2D.font = "bold 12px Alte Haas Grotesk";
    ctx2D.fillStyle = "white";
  } else {
    ctx2D.fillStyle = airdayCal.colourScheme.labels.toString();
    ctx2D.font = "12px Alte Haas Grotesk";
  }
  ctx2D.fillText(text, offset + padding, 25);
}

export function timeNow(airdayCal: AirdayCal) {
  const ctx2D = airdayCal.ctx2D;
  const now = new Date();
  const y = airdayCal.transform.timeToY(now);
  const nowCol = airdayCal.colourScheme.now.toString();
  const nowHour = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;
  ctx2D.textAlign = "right";
  ctx2D.textBaseline = "middle";
  ctx2D.font = `${airdayCal.TIME_FONT_SIZE}px Alte Haas Grotesk`;
  hzLine(airdayCal, y, { strokeStyle: nowCol, lineWidth: 0.5 });
  ctx2D.fillStyle = nowCol;
  ctx2D.fillText(
    `${nowHour.toString()}`,
    airdayCal.transform.gridOffset[0] - airdayCal.transform.margin,
    y,
  );
}
