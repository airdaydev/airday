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

function renderDay(
  wrker: EventRenderer,
  theme: Theme = "light",
  clip: number,
): [number, ImageBitmap] {
  const globalScheme = theme === "light" ? lightScheme : darkScheme;
  const colourScheme = theme === "light" ? lightEventSchemes : darkEventSchemes;
  if (!wrker.ctx2D) throw new Error("offscreen ctx2d not ready");
  const events = wrker.cache.get(clip) || []; // Get events per day
  // Array.from(unsorted).sort(() => {

  // })
  const posMap = new Map<string, any>();
  // TODO: Check assumption that events have been sorted chronologically!
  // Clusters [1,2,3...], Segments [1,2,3...]
  // Segments
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
  let clusterYMax = 0;
  let maxSegment = 1; // per cluster
  const clusterSegments: number[] = [];
  function nextCluster(posY: number, height: number, segment: number) {
    const largestSegment = Math.max(maxSegment, segment);
    maxSegment = largestSegment;
    if (posY > clusterYMax && clusterYMax > 0) {
      maxSegment = 1;
      clusterIndex++;
    }
    clusterSegments[clusterIndex] = clusterSegments[clusterIndex]
      ? largestSegment + 1
      : 1;
    const max = posY + height;
    clusterYMax = max;
    return clusterIndex;
  }
  events.forEach((id) => {
    const event = wrker.idCache.get(id);
    const startTime = event.start < clip ? clip : event.start;
    const endTime = event.end > clip + 864e5 ? clip + 864e5 : event.end;
    const height = Math.max((endTime - startTime) / 1000 / 60, 22);
    const y = timeToY(new Date(startTime), wrker.transform.hourPx);
    const startsToday = event.start > clip;
    const segment = nextSegment(y, height);
    const cluster = nextCluster(y, height, segment);
    posMap.set(id, {
      startTime,
      endTime,
      height,
      y,
      startsToday,
      segment,
      cluster,
    });
  });
  let ops: (() => void)[][] = [];
  function addOp(segment: number, op: () => void) {
    if (!ops[segment]) ops[segment] = [op];
    else ops[segment].push(op);
  }
  events.forEach((id) => {
    const event = wrker.idCache.get(id);
    const position = posMap.get(id);
    const segments = clusterSegments[position.cluster];
    const segmentSize = (wrker.transform.dayPx - 3) / segments;
    const x = segmentSize * position.segment;
    // if (Number.isNaN(x))
    //   throw new Error(`x = NaN {
    //     ${position.cluster}
    //     ${cluster}
    //     ${segmentSize},
    //     ${position.segment},
    //   }`);
    const scheme = colourScheme[event.color] || colourScheme.blue;
    // Height calc
    // If event starts before today, event start is beginning of day
    // If event starts starts today, event is event time
    // If event ends after today, event end time is end of day
    // If event ends today, event end time is end time
    addOp(position.segment, () => {
      wrker.ctx2D.shadowColor = scheme.shadow;
      wrker.ctx2D.shadowBlur = 3;
      wrker.ctx2D.shadowOffsetX = 2;
      wrker.ctx2D.shadowOffsetY = 2;
      wrker.ctx2D.beginPath();
      const cornerRadii = [
        position.startsToday ? 2 : 0,
        position.startsToday ? 2 : 0,
        2,
        2,
      ];
      // outline
      wrker.ctx2D.fillStyle = globalScheme.bg;
      wrker.ctx2D.beginPath();
      wrker.ctx2D.roundRect(
        segmentSize * position.segment - 0.5,
        position.y - 0.5,
        wrker.transform.dayPx - x - 4,
        position.height + 1,
        cornerRadii,
      );
      wrker.ctx2D.fill();
      wrker.ctx2D.closePath();
      wrker.ctx2D.beginPath();
      // wrker.ctx2D.fillStyle = "rgb(255 240 190)"; // light
      wrker.ctx2D.fillStyle = scheme.bg;
      wrker.ctx2D.roundRect(
        segmentSize * position.segment,
        position.y,
        wrker.transform.dayPx - x - 5,
        position.height,
        cornerRadii,
      );
      wrker.ctx2D.fill();
      wrker.ctx2D.closePath();
      wrker.ctx2D.beginPath();
      // wrker.ctx2D.fillStyle = "#ffdc68"; // light
      wrker.ctx2D.fillStyle = scheme.fg;
      const pillRadii = [position.startsToday ? 2 : 0, 0, 0, 2];
      wrker.ctx2D.roundRect(x, position.y, 3, position.height, pillRadii);
      wrker.ctx2D.fill();
      wrker.ctx2D.closePath();
      wrker.ctx2D.shadowColor = "#00000000"; // reset
      wrker.ctx2D.fillStyle = scheme.text;
      if (position.startsToday) {
        const path = new Path2D();
        path.rect(
          segmentSize * position.segment,
          position.y,
          wrker.transform.dayPx - x - 5,
          position.height,
        );
        wrker.ctx2D.save();
        wrker.ctx2D.clip(path);
        wrker.ctx2D?.fillText(
          `${event.title};c${position.cluster};s${position.segment}`,
          x + 6,
          position.y + 4,
        );
        if (position.height > 24) {
          wrker.ctx2D.fillStyle = scheme.fg;
          wrker.ctx2D?.fillText(
            `${getTime(event.start)}`,
            x + 8,
            position.y + 4 + 16,
          );
          wrker.ctx2D?.fillText(
            `${ddmm(event.start)}`,
            x + 8,
            position.y + 4 + 32,
          );
        }
        wrker.ctx2D.restore();
      }
    });
  });
  ops.map((fmap) => {
    fmap.map((f) => f());
  });
  const utcDay = utcZeroDate(new Date(clip)).valueOf();
  wrker.ctx2D.font = "16px bold";
  wrker.ctx2D.fillText(`clip:${new Date(clip).getDate()}`, 0, 0);
  wrker.ctx2D.fillText(`zero:${new Date(utcDay).getUTCDate()}`, 0, 32);
  wrker.ctx2D.font = "09px Departure Mono";
  const bitmap = wrker.canvas.transferToImageBitmap();
  wrker.dirty.delete(clip);
  return [utcDay, bitmap];
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
      this.render();
    }
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
  };
  render() {
    // TODO: This should be a queue tbh
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
          const [utcDay, bitmap] = renderDay(this, this.theme, clip);
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
