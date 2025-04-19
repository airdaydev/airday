import { AirdayCal } from "../cal";
import { isWeekend } from "../time";
import { dayLabel, vtLine } from "./label";

export function days(airdayCal: AirdayCal, dates: Date[], offsetPx: number) {
  const ctx2D = airdayCal.ctx2D;
  ctx2D.save();
  const path = new Path2D();
  path.rect(
    airdayCal.transform.gridOffset[0],
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
        airdayCal.transform.headerHeight,
        airdayCal.transform.dayPx,
        airdayCal.canvas.offsetHeight,
      );
    }
    vtLine(airdayCal, offset, airdayCal.transform.headerHeight);
    dayLabel(airdayCal, date, offset);
  });
  ctx2D.restore();
}
