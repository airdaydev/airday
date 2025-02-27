import { AirdayCal } from "../cal";
import { isWeekend } from "../time";
import { dayLabel, hzLine, vtLine } from "./label";

export function times(
  airdayCal: AirdayCal,
  firstHour: number,
  firstHourPx: number,
) {
  const ctx2D = airdayCal.ctx2D;
  ctx2D.textAlign = "right";
  ctx2D.textBaseline = "middle";
  ctx2D.font = `${airdayCal.TIME_FONT_SIZE}px Alte Haas Grotesk`;
  let pxOffset = firstHourPx + airdayCal.gridOffset[1];
  ctx2D.save();
  const path = new Path2D();
  path.rect(
    0,
    airdayCal.gridOffset[1],
    airdayCal.canvas.offsetWidth,
    airdayCal.canvas.offsetHeight,
  );
  ctx2D.clip(path);
  const now = new Date();
  const y = airdayCal.transform.timeToY(now);
  ctx2D.fillStyle = airdayCal.colourScheme.labels.toString();
  for (
    let i = firstHour;
    i <=
    firstHour +
      airdayCal.transform.hoursVisible(airdayCal.scrollable.offsetHeight);
    i++
  ) {
    if (i >= 1 && i <= 24) {
      if (Math.abs(pxOffset - y) < airdayCal.TIME_FONT_SIZE) {
        // Hides time if obscured by current hour
      } else {
        ctx2D.fillText(
          `${i.toString().padStart(2, "0")}:00`,
          airdayCal.gridOffset[0] - airdayCal.margin,
          pxOffset,
        );
      }
      hzLine(airdayCal, pxOffset);
    }
    pxOffset += airdayCal.transform.hourPx;
  }
  ctx2D.restore();
}

export function days(airdayCal: AirdayCal, dates: Date[], offsetPx: number) {
  const ctx2D = airdayCal.ctx2D;
  ctx2D.save();
  const path = new Path2D();
  path.rect(
    airdayCal.gridOffset[0],
    0,
    airdayCal.canvas.offsetWidth,
    airdayCal.canvas.offsetHeight,
  );
  ctx2D.clip(path);
  dates.map((date, index) => {
    const offset = index * airdayCal.transform.dayPx + offsetPx;
    if (isWeekend(date)) {
      // Weekend shading
      ctx2D.fillStyle = airdayCal.colourScheme.shade.toString();
      ctx2D.fillRect(
        offset,
        airdayCal.headerHeight,
        airdayCal.transform.dayPx,
        airdayCal.canvas.offsetHeight,
      );
    }
    vtLine(airdayCal, offset, airdayCal.headerHeight);
    dayLabel(airdayCal, date, offset);
  });
  ctx2D.restore();
}
