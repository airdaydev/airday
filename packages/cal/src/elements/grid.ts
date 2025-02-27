import { CalRenderer } from "../render";
import { isWeekend } from "../time";
import { dayLabel, hzLine, vtLine } from "./label";

export function times(
  renderer: CalRenderer,
  firstHour: number,
  firstHourPx: number,
) {
  const ctx2D = renderer.ctx2D;
  ctx2D.textAlign = "right";
  ctx2D.textBaseline = "middle";
  ctx2D.font = `${renderer.TIME_FONT_SIZE}px Alte Haas Grotesk`;
  let pxOffset = firstHourPx + renderer.gridOffset[1];
  ctx2D.save();
  const path = new Path2D();
  path.rect(
    0,
    renderer.gridOffset[1],
    renderer.canvas.offsetWidth,
    renderer.canvas.offsetHeight,
  );
  ctx2D.clip(path);
  const now = new Date();
  const y = renderer.transform.timeToY(now);
  ctx2D.fillStyle = renderer.colourScheme.labels.toString();
  for (
    let i = firstHour;
    i <=
    firstHour +
      renderer.transform.hoursVisible(renderer.scrollable.offsetHeight);
    i++
  ) {
    if (i >= 1 && i <= 24) {
      if (Math.abs(pxOffset - y) < renderer.TIME_FONT_SIZE) {
        // Hides time if obscured by current hour
      } else {
        ctx2D.fillText(
          `${i.toString().padStart(2, "0")}:00`,
          renderer.gridOffset[0] - renderer.margin,
          pxOffset,
        );
      }
      hzLine(renderer, pxOffset);
    }
    pxOffset += renderer.transform.hourPx;
  }
  ctx2D.restore();
}

export function days(renderer: CalRenderer, dates: Date[], offsetPx: number) {
  const ctx2D = renderer.ctx2D;
  ctx2D.save();
  const path = new Path2D();
  path.rect(
    renderer.gridOffset[0],
    0,
    renderer.canvas.offsetWidth,
    renderer.canvas.offsetHeight,
  );
  ctx2D.clip(path);
  dates.map((date, index) => {
    const offset = index * renderer.transform.dayPx + offsetPx;
    if (isWeekend(date)) {
      // Weekend shading
      ctx2D.fillStyle = renderer.colourScheme.shade.toString();
      ctx2D.fillRect(
        offset,
        renderer.headerHeight,
        renderer.transform.dayPx,
        renderer.canvas.offsetHeight,
      );
    }
    vtLine(renderer, offset, renderer.headerHeight);
    dayLabel(renderer, date, offset);
  });
  ctx2D.restore();
}
