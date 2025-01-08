// import { CalendarEvent } from "../model";

const canvas = new OffscreenCanvas(100, 100);
const ctx2D = canvas.getContext("2d");

console.debug("event worker ready");

const cache = new Map<number, Set<any>>();
const stale = new Set<number>();

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

function updateCache(events: any[], range: [number, number]) {
  events.forEach((event) => {
    const start = Math.max(event.start.valueOf(), range[0] as number);
    const end = Math.min(event.end.valueOf(), range[1] as number);
    const days = Math.ceil((end - start) / 864e5);
    const startDay = getStartOfDay(new Date(start)).valueOf();
    for (let i = 0; i < days; i++) {
      const day = startDay + i * 864e5;
      addMapSet(cache, day, event);
      stale.add(day);
    }
  });
  for (let day of cache.keys()) {
    if (day < range[0] || day > range[1]) {
      cache.delete(day);
    }
  }
}

function scale() {
  if (!ctx2D) throw new Error("offscreen ctx2d not ready");
  canvas.width = transform.dayColWidth;
  canvas.height = transform.height;
  ctx2D.scale(transform.scale, transform.scale);
  ctx2D.textBaseline = "top";
  ctx2D.font = "8px alte haas grotesk";
}

function renderCache() {
  if (!ctx2D) throw new Error("offscreen ctx2d not ready");
  let j = 0;
  scale();
  for (let date of stale) {
    let i = 0;
    ctx2D.clearRect(0, 0, canvas.width, canvas.height);
    cache.get(date)?.forEach((event) => {
      const x = 0;
      ctx2D.fillStyle = "#eceeff";
      ctx2D.beginPath();
      ctx2D.roundRect(x, i * 20, transform.dayColWidth - 10, 20, 5);
      ctx2D.fill();
      ctx2D.closePath();
      ctx2D.fillStyle = "#33343c";
      ctx2D?.fillText(event.title, x, i * 20 + 4);
      i++;
    });
    j++;
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ type: "day", date: date, bitmap }, [bitmap]);
  }
}

self.onmessage = (message: MessageEvent) => {
  // Will have to rerender all days
  if (message.data.type === "resize") {
    if (!ctx2D) throw new Error("offscreen ctx2d not ready");
    transform.dayColWidth = message.data.params.dayColWidth || 100;
    transform.height = message.data.params.height;
    transform.width = message.data.params.width;
    transform.scale = message.data.params.scale;
  }
  if (message.data.type === "load") {
    if (!ctx2D) throw new Error("offscreen ctx2d not ready");
    updateCache(message.data.events, message.data.range);
    renderCache();
  }
};
