import { DayLayout } from "./layout";
import { utcZeroDate } from "../time";
import {
  darkScheme,
  lightScheme,
  darkEventSchemes,
  lightEventSchemes,
  Theme,
  RGBA,
} from "../colours";
import { Rect } from "../canvas";
import { rectIntersection } from "../ui-objects";

function parseColourScheme(colour: any): "yellow" | "blue" {
  if (typeof colour !== "string") return "blue";
  if (colour !== "blue" && colour !== "yellow") return "blue";
  return colour;
}

interface RenderOptions {
  region?: Rect;
  shadows?: boolean;
  theme?: Theme;
  debug?: boolean;
  offset?: [number, number];
  highlightId?: string;
  fadeTs?: number;
}

export function renderDay(
  ctx2D: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  dayLayout: DayLayout,
  clip: number,
  renderOpts: RenderOptions = {},
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  // Customise
  const theme = renderOpts.theme || "dark";
  const shadows = renderOpts.shadows ?? true;
  const region = renderOpts.region;
  // Render
  let ops: (() => void)[][] = [];
  function addOp(segment: number, op: () => void) {
    if (!ops[segment]) ops[segment] = [op];
    else ops[segment].push(op);
  }
  if (!ctx2D) throw new Error("offscreen ctx2d not ready");
  ctx2D.textBaseline = "top";
  const offset = renderOpts.offset || [0, 0];

  dayLayout.map.forEach((layout) => {
    // Skip events outside region
    if (region && !rectIntersection(layout, region)) return;
    // Render
    const globalScheme = theme === "light" ? lightScheme : darkScheme;
    const colourScheme =
      theme === "light" ? lightEventSchemes : darkEventSchemes;
    const scheme = colourScheme[parseColourScheme(layout.color)];
    // Height calc
    // If event starts before today, event start is beginning of day
    // If event starts starts today, event is event time
    // If event ends after today, event end time is end of day
    // If event ends today, event end time is end time
    addOp(layout.segment, () => {
      ctx2D.font = "10px 'Alte Haas Grotesk'";
      let x = offset ? layout.x + offset[0] : layout.x;
      let y = offset ? layout.y + offset[1] : layout.y;
      if (shadows) {
        ctx2D.shadowColor = scheme.shadow.toString();
        ctx2D.shadowBlur = 3;
        ctx2D.shadowOffsetX = 2;
        ctx2D.shadowOffsetY = 2;
      }
      ctx2D.beginPath();
      const cornerRadii = [
        layout.startsToday ? 2 : 0,
        layout.startsToday ? 2 : 0,
        2,
        2,
      ];
      // outline
      ctx2D.fillStyle = globalScheme.bg.toString();
      ctx2D.beginPath();
      ctx2D.roundRect(
        x - 0.5,
        y - 0.5,
        layout.width - 4,
        layout.height + 1,
        cornerRadii,
      );
      ctx2D.fill();
      ctx2D.closePath();
      // Main
      ctx2D.beginPath();
      ctx2D.fillStyle = scheme.bg.toString();
      ctx2D.roundRect(x, y, layout.width - 5, layout.height, cornerRadii);
      if (layout.id === renderOpts.highlightId) {
        let color = scheme.bg;
        if (renderOpts.fadeTs) {
          color = RGBA.tween(
            scheme.bg,
            scheme.bg.highlight(),
            Math.max(0.5, (performance.now() - renderOpts.fadeTs) / 75),
          );
        }
        ctx2D.fillStyle = color.toString(); // light
      }
      ctx2D.fill();
      ctx2D.closePath();
      // Pill
      ctx2D.beginPath();
      ctx2D.fillStyle = scheme.fg.toString();
      const pillRadii = [layout.startsToday ? 2 : 0, 0, 0, 2];
      ctx2D.roundRect(x, y, 3, layout.height, pillRadii);
      ctx2D.fill();
      ctx2D.closePath();
      ctx2D.shadowColor = "#00000000"; // reset
      ctx2D.fillStyle = scheme.text.toString();
      // ctx2D.fillStyle = "#FFFFFF88"; // reset
      if (layout.startsToday) {
        const path = new Path2D();
        path.rect(x, y, layout.width - 5, layout.height);
        ctx2D.save();
        ctx2D.clip(path);
        ctx2D?.fillText(layout.displayText, x + 6, y + 4);
        if (layout.height > 24) {
          ctx2D.fillStyle = scheme.fg.toString();
          ctx2D?.fillText(layout.displayTime, x + 8, y + 4 + 16);
          // ctx2D?.fillText(`${ddmm(event.start)}`, x + 8, layout.y + 4 + 32);
        }
        ctx2D.restore();
      }
    });
  });
  if (region) {
    ctx2D.save();
    ctx2D.beginPath();
    ctx2D.rect(
      region.x + offset[0],
      region.y + offset[1],
      region.width,
      region.height,
    );
    ctx2D.clip();
  }
  ops.map((fmap) => {
    fmap.map((f) => f());
  });
  if (region) {
    ctx2D.restore();
  }
  if (renderOpts.debug) {
    const utcDay = utcZeroDate(new Date(clip)).valueOf();
    ctx2D.fillStyle = "#f7204b";
    ctx2D.font = "16px bold";
    ctx2D.fillText(`clip:${new Date(clip).getDate()}`, 0, 0);
    ctx2D.fillText(`zero:${new Date(utcDay).getUTCDate()}`, 0, 32);
    ctx2D.font = "12px 'Alte Haas Grotesk'";
  }
  return ctx2D;
}
