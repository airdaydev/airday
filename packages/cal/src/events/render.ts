import {
  localMidnight,
  addDaysNumber,
  getTime,
  timeToY,
  utcZeroDate,
} from "../time";
import {
  darkScheme,
  lightScheme,
  darkEventSchemes,
  lightEventSchemes,
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

function renderCache(wrker: EventRenderer, theme: "light" | "dark" = "light") {
  const globalScheme = theme === "light" ? lightScheme : darkScheme;
  const colourScheme = theme === "light" ? lightEventSchemes : darkEventSchemes;
  if (!wrker.ctx2D) throw new Error("offscreen ctx2d not ready");
  let j = 0;
  const map = new Map();
  // Cycle through each day
  for (
    let clip = wrker.range[0];
    clip <= wrker.range[1];
    clip = addDaysNumber(clip, 1)
  ) {
    if (!wrker.dirty.has(clip)) {
      // Only rerender items marked as dirty
      continue;
    }
    const events = wrker.cache.get(clip) || []; // Get events per day
    const posMap = new Map<string, any>();
    // TODO: Check assumption that events have been sorted chronologically
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
    const clusterSegments = [];
    function nextCluster(posY: number, height: number, segment: number) {
      const largestSegment = Math.max(maxSegment, segment);
      clusterSegments[clusterIndex] = clusterSegments[clusterIndex]
        ? largestSegment + 1
        : 1;
      maxSegment = largestSegment;
      if (posY > clusterYMax) {
        maxSegment = 1;
        clusterIndex++;
      }
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
    // console.log(new Date(clip), clusterSegments);
    wrker.ctx2D.clearRect(0, 0, wrker.canvas.width, wrker.canvas.height);
    let ops: (() => void)[][] = [];
    function addOp(segment: number, op: () => void) {
      if (!ops[segment]) ops[segment] = [op];
      else ops[segment].push(op);
    }
    events.forEach((id) => {
      const event = wrker.idCache.get(id);
      const position = posMap.get(id);
      const cluster = clusterSegments[position.cluster];
      const segmentSize = (wrker.transform.dayPx - 3) / cluster;
      const x = segmentSize * position.segment;
      const scheme = colourScheme.yellow;
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
        wrker.ctx2D.roundRect(x, position.y, 3, position.height, cornerRadii);
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
          wrker.ctx2D?.fillText(`${event.title}`, x + 6, position.y + 4);
          if (position.height > 24) {
            wrker.ctx2D.fillStyle = scheme.fg;
            wrker.ctx2D?.fillText(
              `${getTime(event.start)}`,
              x + 8,
              position.y + 4 + 16,
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
    const bitmap = wrker.canvas.transferToImageBitmap();
    map.set(utcDay, bitmap);
    j++;
    // wrker.postMessage({ type: "day", date: utcDay, bitmap }, [bitmap] as any);
    wrker.dirty.delete(clip);
  }
  map.forEach((v, k) =>
    self.postMessage({ type: "day", date: k, bitmap: v }, [v] as any),
  );
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
  cache = new Map<number, Set<any>>();
  dirty = new Set<number>();
  constructor(headless = false) {
    self.addEventListener("message", this.onMessage);
    if (!headless) {
      this._canvas = new OffscreenCanvas(100, 100);
      const ctx = this._canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2D Canvas Context");
      this._ctx2D = ctx;
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
    if (message.data.type === "resize") {
      this.transform.dayPx = message.data.params.dayPx || 100;
      this.transform.hourPx = message.data.params.hourPx;
      this.transform.scale = message.data.params.scale;
      this.offscreenScale();
      renderCache(this);
    }
    if (message.data.type === "load") {
      this.updateCache(message.data.events, message.data.range);
      renderCache(this);
      for (
        let i = new Date(this.range[0]).valueOf();
        i < this.range[1];
        i = i + 864e5
      ) {
        this.dirty.delete(i);
      }
    }
  };
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
        addMapSet(this.cache, day, event.id);
        this.dirty.add(day);
        this.idCache.set(event.id, event);
      }
    });
  }
}
