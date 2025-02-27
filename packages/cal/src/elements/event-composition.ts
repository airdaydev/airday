import { CalRenderer } from "../render";
import { utcZeroDate } from "../time";

export function eventComposition(
  renderer: CalRenderer,
  dates: Date[],
  offsetPx: number,
) {
  const ctx2D = renderer.ctx2D;
  ctx2D.save();
  const path = new Path2D();
  path.rect(
    renderer.gridOffset[0],
    renderer.gridOffset[1],
    renderer.canvas.offsetWidth,
    renderer.canvas.offsetHeight,
  );
  ctx2D.clip(path);
  ctx2D.textAlign = "left";
  ctx2D.textBaseline = "top";
  dates.map((date, index) => {
    const offset = index * renderer.transform.dayPx + offsetPx;
    const image = renderer.eventCache.bitmapMap.get(date.valueOf());
    if (image) {
      if (!renderer.firstRender) renderer.firstRender = performance.now();
      if (renderer.firstRender) {
        const diff = performance.now() - renderer.firstRender;
        ctx2D.globalAlpha = diff < 150 ? diff / 150 : 1;
        if (diff < 150) renderer.act();
      }
      ctx2D.drawImage(
        image,
        offset,
        -renderer.transform.offset[1] + renderer.gridOffset[1],
        renderer.transform.dayPx,
        renderer.transform.hourPx * 25,
      );
      ctx2D.globalAlpha = 1;
    }
    const zero = utcZeroDate(
      new Date(renderer.uiObjects.hover?.date),
    ).valueOf();
    if (date.valueOf() === zero) {
      renderer.eventCache.renderRegion(
        renderer.uiObjects.hover?.date,
        renderer.uiObjects.hover?.region,
        [offset, -renderer.transform.offset[1] + renderer.gridOffset[1]],
        renderer.uiObjects.hover.id,
        renderer.uiObjects.hover.ts,
      );
    }
  });
  ctx2D.restore();
}
