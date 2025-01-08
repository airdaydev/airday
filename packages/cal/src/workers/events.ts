// import { CalendarEvent } from "../model";

const canvas = new OffscreenCanvas(100, 100);
const ctx2D = canvas.getContext("2d");

console.debug("event worker ready");

const cache = new Map<number, Set<any>>();

const transform = {
  dayColWidth: 100,
  width: 100,
  height: 100,
  scale: 1,
};

function addMapSet<K, V>(map: Map<K, Set<V>>, key: K, val: V) {
  const set = map.get(key);
  if (!set) {
    const newSet = new Set([val]);
    map.set(key, newSet);
  } else set.add(val);
}

function getStartOfDay(date: Date) {
  const start = new Date(date);
  start.setHours(0);
  start.setMinutes(0);
  start.setSeconds(0);
  return start;
}

function constructDayMap(events: any[], range: [number, number]) {
  events.forEach((event) => {
    const start = Math.max(event.start.valueOf(), range[0] as number);
    const end = Math.min(event.end.valueOf(), range[1] as number);
    const days = Math.ceil((end - start) / 864e5);
    const startDay = getStartOfDay(new Date(start)).valueOf();
    for (let i = 0; i < days; i++) {
      const day = startDay + i * 864e5;
      addMapSet(cache, day, event);
    }
  });
}

function scale() {
  if (!ctx2D) throw new Error("offscreen ctx2d not ready");
  canvas.width = transform.width;
  canvas.height = transform.height;
  ctx2D.scale(transform.scale, transform.scale);
}

function renderCache() {
  if (!ctx2D) throw new Error("offscreen ctx2d not ready");
  let j = 0;
  for (let kv of cache.entries()) {
    let i = 0;
    kv[1].forEach((event) => {
      const x = transform.dayColWidth * j;
      ctx2D.fillStyle = "#ccc";
      ctx2D.fillRect(x, i * 10, 100, 20);
      ctx2D.fillStyle = "#fff";
      ctx2D?.fillText(event.title, x, i * 10);
      i++;
    });
    j++;
  }
  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({ type: "frame", bitmap }, [bitmap]);
}

self.onmessage = (message: MessageEvent) => {
  // Will have to rerender all days
  if (message.data.type === "resize") {
    if (!ctx2D) throw new Error("offscreen ctx2d not ready");
    transform.dayColWidth = message.data.params.dayColWidth || 100;
    transform.height = message.data.params.height;
    transform.width = message.data.params.width;
    transform.scale = message.data.params.scale;
    console.log(transform);
    scale();
    renderCache();
  }
  if (message.data.type === "load") {
    if (!ctx2D) throw new Error("offscreen ctx2d not ready");
    ctx2D.textBaseline = "top";
    ctx2D.font = "10px departure mono";
    constructDayMap(message.data.events, message.data.range);
    renderCache();
  }
};
