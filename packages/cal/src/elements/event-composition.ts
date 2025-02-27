import { AirdayCal } from "../cal";
import { utcZeroDate } from "../time";

export function eventComposition(
  airdayCal: AirdayCal,
  dates: Date[],
  offsetPx: number,
) {
  const ctx2D = airdayCal.ctx2D;
  ctx2D.save();
  const path = new Path2D();
  path.rect(
    airdayCal.gridOffset[0],
    airdayCal.gridOffset[1],
    airdayCal.canvas.offsetWidth,
    airdayCal.canvas.offsetHeight,
  );
  ctx2D.clip(path);
  ctx2D.textAlign = "left";
  ctx2D.textBaseline = "top";
  dates.map((date, index) => {
    const offset = index * airdayCal.transform.dayPx + offsetPx;
    const image = airdayCal.eventCache.bitmapMap.get(date.valueOf());
    if (image) {
      if (!airdayCal.firstRender) airdayCal.firstRender = performance.now();
      if (airdayCal.firstRender) {
        const diff = performance.now() - airdayCal.firstRender;
        ctx2D.globalAlpha = diff < 150 ? diff / 150 : 1;
        if (diff < 150) airdayCal.act();
      }
      ctx2D.drawImage(
        image,
        offset,
        -airdayCal.transform.offset[1] + airdayCal.gridOffset[1],
        airdayCal.transform.dayPx,
        airdayCal.transform.hourPx * 25,
      );
      ctx2D.globalAlpha = 1;
    }
    const zero = utcZeroDate(
      new Date(airdayCal.uiObjects.hover?.date),
    ).valueOf();
    if (date.valueOf() === zero) {
      airdayCal.eventCache.renderRegion(
        airdayCal.uiObjects.hover?.date,
        airdayCal.uiObjects.hover?.region,
        [offset, -airdayCal.transform.offset[1] + airdayCal.gridOffset[1]],
        airdayCal.uiObjects.hover.id,
        airdayCal.uiObjects.hover.ts,
      );
    }
  });
  ctx2D.restore();
}
