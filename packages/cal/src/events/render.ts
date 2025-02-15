import {
  localMidnight,
  addDaysNumber,
  getTime,
  timeToY,
  utcZeroDate,
  ddmm,
} from "../time";
import {
  darkScheme,
  lightScheme,
  darkEventSchemes,
  lightEventSchemes,
  Theme,
} from "../colours";

interface Transform {
  dayPx: number;
  hourPx: number;
  scale: number;
}

// This worker prepares events for rendering & renders them to an offscreen canvas

function addMapSet<K, V>(map: Map<K, Set<V>>, key: K, val: V) {
  const set = map.get(key);
  if (!set) {
    const newSet = new Set([val]);
    map.set(key, newSet);
  } else {
    set.add(val);
  }
}

// Loop through range
// Skip dirty days
// Set positions
// Collect render calls in segment order
// Render each segment 0-n

function parseColourScheme(colour: any): "yellow" | "blue" {
  if (typeof colour !== "string") return "blue";
  if (colour !== "blue" && colour !== "yellow") return "blue";
  return colour;
}

export interface EventLayout {
  startTime: number;
  endTime: number;
  width: number;
  height: number;
  x: number;
  y: number;
  startsToday: boolean;
  segment: number;
  cluster: number;
  displayText: string;
  displayTime: string;
  color: string;
}

// class EventLayoutTransfer {
//   static pack(layout: EventLayout) {
//     return Object.keys(() => {

//     })
//   }
//   static unpack() {

//   }
// }

type DayLayoutMap = Map<string, EventLayout>;
export type Cluster = { minY: number; maxY: number; segments: number };

export interface DayLayout {
  map: DayLayoutMap;
  clusters: Cluster[];
}

/**
 * Gets layout for a whole day
 * Divides into clusters (of shared contiguous vertical space), and then horizontal segments
 * TODO: Check assumption that events have been sorted chronologically!
 */
function calcDayLayout(
  eventCache: Map<string, any>,
  events: Set<string>,
  clip: number,
  hourHeight: number,
  dayPx: number,
): DayLayout {
  const layoutMap = new Map<string, EventLayout>();
  const segPosMap = new Map<number, number>(); // segment, lastYPos
  function nextSegment(posY: number, height: number) {
    let i = 0; // segment number
    while (true) {
      const lastPos = segPosMap.get(i);
      // If segment is empty, or posY exists after last position in segment
      if (!lastPos || posY > lastPos) {
        segPosMap.set(i, posY + height);
        break;
      }
      i++; // go to next segment
    }
    return i;
  }

  let clusterIndex = 0;
  let clusterMinY: number | null = null; // maximum y position per cluster
  let clusterMaxY = 0; // maximum y position per cluster
  let maxSegments = 1;
  const clusters: Cluster[] = [];

  function nextCluster2(posY: number, height: number, segment: number) {
    const maxY = posY + height; // maxY for this event
    maxSegments = Math.max(maxSegments, segment); // max segment count for this cluster
    if (clusterMinY === null) {
      clusterMinY = posY; // triggers for first cluster only
    }
    // condition checking next position is clear of previous, and we are passed the first cluster
    if (posY > clusterMaxY && clusterMaxY > 0) {
      // Reset & move
      maxSegments = 1;
      clusterMinY = posY;
      clusterIndex++;
    }
    clusterMaxY = Math.max(maxY, clusterMaxY); // maxY for cluster
    const newSegment = !clusters[clusterIndex];
    clusters[clusterIndex] = {
      minY: clusterMinY,
      maxY: clusterMaxY,
      segments: newSegment ? 1 : maxSegments + 1,
    };
    return clusterIndex;
  }

  events.forEach((id) => {
    const event = eventCache.get(id);
    const startTime = event.start < clip ? clip : event.start;
    const endTime = event.end > clip + 864e5 ? clip + 864e5 : event.end;
    const height = Math.max((endTime - startTime) / 1000 / 60, 22);
    const y = timeToY(new Date(startTime), hourHeight);
    const startsToday = event.start > clip;
    const segment = nextSegment(y, height);
    const cluster = nextCluster2(y, height, segment);
    layoutMap.set(id, {
      startTime,
      endTime,
      width: 0, // unset yet
      height,
      x: 0, // unset yet
      y,
      startsToday,
      segment,
      cluster,
      displayText: `${event.title};c${cluster};s${segment}`,
      displayTime: getTime(event.start),
      color: event.color,
    });
  });
  layoutMap.forEach((layout) => {
    const cluster = clusters[layout.cluster];
    const segmentSize = (dayPx - 3) / cluster.segments;
    const x = segmentSize * layout.segment;
    const width = dayPx - x;
    Object.assign(layout, { width, x });
  });
  return {
    map: layoutMap,
    clusters,
  };
}

export function renderDay(
  renderer: EventRenderer,
  dayLayout: DayLayout,
  clip: number,
  theme: Theme = "light",
): ImageBitmap {
  let ops: (() => void)[][] = [];
  function addOp(segment: number, op: () => void) {
    if (!ops[segment]) ops[segment] = [op];
    else ops[segment].push(op);
  }
  const ctx2D = renderer.ctx2D;
  if (!renderer.ctx2D) throw new Error("offscreen ctx2d not ready");
  dayLayout.map.forEach((layout) => {
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
      ctx2D.shadowColor = scheme.shadow;
      ctx2D.shadowBlur = 3;
      ctx2D.shadowOffsetX = 2;
      ctx2D.shadowOffsetY = 2;
      ctx2D.beginPath();
      const cornerRadii = [
        layout.startsToday ? 2 : 0,
        layout.startsToday ? 2 : 0,
        2,
        2,
      ];
      // outline
      ctx2D.fillStyle = globalScheme.bg;
      ctx2D.beginPath();
      ctx2D.roundRect(
        layout.x - 0.5,
        layout.y - 0.5,
        layout.width - 4,
        layout.height + 1,
        cornerRadii,
      );
      ctx2D.fill();
      ctx2D.closePath();
      ctx2D.beginPath();
      ctx2D.fillStyle = scheme.bg;
      ctx2D.roundRect(
        layout.x,
        layout.y,
        layout.width - 5,
        layout.height,
        cornerRadii,
      );
      ctx2D.fill();
      ctx2D.closePath();
      ctx2D.beginPath();
      // ctx2D.fillStyle = "#ffdc68"; // light
      ctx2D.fillStyle = scheme.fg;
      const pillRadii = [layout.startsToday ? 2 : 0, 0, 0, 2];
      ctx2D.roundRect(layout.x, layout.y, 3, layout.height, pillRadii);
      ctx2D.fill();
      ctx2D.closePath();
      ctx2D.shadowColor = "#00000000"; // reset
      ctx2D.fillStyle = scheme.text;
      // ctx2D.fillStyle = "#FFFFFF88"; // reset
      if (layout.startsToday) {
        const path = new Path2D();
        path.rect(layout.x, layout.y, layout.width - 5, layout.height);
        ctx2D.save();
        ctx2D.clip(path);
        ctx2D?.fillText(layout.displayText, layout.x + 6, layout.y + 4);
        if (layout.height > 24) {
          ctx2D.fillStyle = scheme.fg;
          ctx2D?.fillText(layout.displayTime, layout.x + 8, layout.y + 4 + 16);
          // ctx2D?.fillText(`${ddmm(event.start)}`, x + 8, layout.y + 4 + 32);
        }
        ctx2D.restore();
      }
    });
  });
  ops.map((fmap) => {
    fmap.map((f) => f());
  });
  const utcDay = utcZeroDate(new Date(clip)).valueOf();
  ctx2D.fillStyle = "red";
  ctx2D.font = "16px bold";
  ctx2D.fillText(`clip:${new Date(clip).getDate()}`, 0, 0);
  ctx2D.fillText(`zero:${new Date(utcDay).getUTCDate()}`, 0, 32);
  ctx2D.font = "12px bold Alte Haas Grotesk";
  const bitmap = renderer.canvas.transferToImageBitmap();
  renderer.dirty.delete(clip);
  return bitmap;
}

export class EventRenderer {
  _canvas?: OffscreenCanvas;
  _ctx2D?: OffscreenCanvasRenderingContext2D;
  transform: Transform = {
    dayPx: 100,
    hourPx: 25,
    scale: 1,
  };
  range = [0, 0];
  idCache = new Map<string, any>();
  cache = new Map<number, Set<string>>(); // unsorted
  dirty = new Set<number>();
  theme: Theme = "light";
  worker: boolean;
  constructor(worker: boolean) {
    this.worker = worker;
    this._canvas = new OffscreenCanvas(100, 100);
    const ctx = this._canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D Canvas Context");
    this._ctx2D = ctx;
    if (worker) {
      self.addEventListener("message", this.onMessage);
    }
    this.render();
  }
  get ctx2D() {
    if (!this._ctx2D) throw new Error("Failed to get 2D Canvas Context");
    return this._ctx2D;
  }
  get canvas() {
    if (!this._canvas) throw new Error("Failed to get canvas");
    return this._canvas;
  }
  offscreenScale() {
    this.canvas.width = this.transform.dayPx * this.transform.scale;
    this.canvas.height = this.transform.hourPx * 25 * this.transform.scale;
    this.ctx2D.scale(this.transform.scale, this.transform.scale);
    this.ctx2D.textBaseline = "top";
    this.ctx2D.font = "09px Departure Mono";
  }
  onMessage = (message: MessageEvent) => {
    if (message.data.type === "config") {
      this.transform.dayPx = message.data.params.dayPx || 100;
      this.transform.hourPx = message.data.params.hourPx;
      this.transform.scale = message.data.params.scale;
      this.theme = message.data.params.theme;
      this.offscreenScale();
    }
    if (message.data.type === "load") {
      this.updateCache(message.data.events, message.data.range);
    }
    if (message.data.type === "reflow") {
      const clip = message.data.clip;
      const events = this.cache.get(clip) || new Set(); // Get day's events
      const layout = calcDayLayout(
        this.idCache,
        events,
        clip,
        this.transform.hourPx,
        this.transform.dayPx,
      );
      // const [utcDay, bitmap] = this.renderDay(layout, clip, "light");
      const utcDay = utcZeroDate(new Date(clip)).valueOf();
      self.postMessage({ type: "reflow", date: utcDay, layout });
    }
  };
  render() {
    // TODO: This could be a smarter queue, we're always rendering
    requestAnimationFrame(() => {
      if (this.dirty.size) {
        const map = new Map<number, ImageBitmap>();
        for (
          let clip = this.range[0];
          clip <= this.range[1];
          clip = addDaysNumber(clip, 1)
        ) {
          if (!this.dirty.has(clip)) {
            // Only rerender days marked as dirty
            continue;
          }
          const events = this.cache.get(clip) || new Set(); // Get day's events
          const layout = calcDayLayout(
            this.idCache,
            events,
            clip,
            this.transform.hourPx,
            this.transform.dayPx,
          );
          const bitmap = this.renderDay(layout, clip);
          const utcDay = utcZeroDate(new Date(clip)).valueOf();
          map.set(utcDay, bitmap);
        }
        Array.from(map).forEach((val) => {
          self.postMessage({ type: "day", date: val[0], bitmap: val[1] }, [
            val[1],
          ] as any);
        });
      }
      this.render();
    });
  }
  renderDay(layout: DayLayout, clip: number, theme = this.theme) {
    return renderDay(this, layout, clip, theme);
  }
  updateCache(events: any[], cacheRange: [number, number]) {
    this.range = cacheRange;
    events.forEach((event) => {
      const start = Math.max(event.start, this.range[0] as number);
      const end = Math.min(event.end, this.range[1] as number);
      const startDay = localMidnight(new Date(start)).valueOf();
      const endDay = localMidnight(new Date(end)).valueOf();
      const days = Math.ceil((endDay - startDay) / 864e5) + 1;
      for (let i = 0; i < days; i++) {
        const day = addDaysNumber(startDay, i); // utc start day
        this.idCache.set(event.id, event);
        addMapSet(this.cache, day, event.id);
        this.dirty.add(day);
      }
    });
  }
}
