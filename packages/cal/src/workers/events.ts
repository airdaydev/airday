const canvas = new OffscreenCanvas(100, 100);
const ctx2D = canvas.getContext("2d");

console.debug("event worker ready");

const idCache = new Map<string, any>();
const cache = new Map<number, Set<any>>();
const fresh = new Set<number>();

const transform = {
  dayWidth: 100,
  height: 100,
  scale: 1,
};

function timeToY(date: Date, hourPx: number) {
  const hours = date.getHours() * hourPx;
  const min = (date.getMinutes() * hourPx) / 60;
  return hours + min;
}

function addMapSet<K, V>(map: Map<K, Set<V>>, key: K, val: V) {
  const set = map.get(key);
  if (!set) {
    const newSet = new Set([val]);
    map.set(key, newSet);
  } else {
    set.add(val);
  }
}

function utcMidnight(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function updateCache(events: any[], range: [number, number]) {
  events.forEach((event) => {
    const start = Math.max(event.start.valueOf(), range[0] as number);
    const end = Math.min(event.end.valueOf(), range[1] as number);
    const days = Math.ceil((end - start) / 864e5);
    const startDay = utcMidnight(new Date(start)).valueOf();
    for (let i = 0; i < days; i++) {
      const day = startDay + i * 864e5;
      addMapSet(cache, day, event.id);
      fresh.add(day);
      idCache.set(event.id, event);
    }
  });
  renderCache();
  for (
    let i = utcMidnight(new Date(range[0])).valueOf();
    i < range[1];
    i = i + 864e5
  ) {
    fresh.delete(i);
  }
  // for (let day of cache.keys()) {
  //   if (day < range[0] || day > range[1]) {
  //     cache.delete(day);
  //   }
  // }
}

function scale() {
  if (!ctx2D) throw new Error("offscreen ctx2d not ready");
  canvas.width = transform.dayWidth * 2;
  canvas.height = transform.height * 2;
  ctx2D.scale(transform.scale, transform.scale);
  ctx2D.textBaseline = "top";
  ctx2D.font = "6px departure mono";
}

function renderCache() {
  if (!ctx2D) throw new Error("offscreen ctx2d not ready");
  let j = 0;
  scale();
  for (let date of fresh) {
    let i = 0;
    ctx2D.clearRect(0, 0, canvas.width, canvas.height);
    cache.get(date)?.forEach((id) => {
      const event = idCache.get(id);
      const x = 0;
      const y = timeToY(new Date(event.start), 50);
      ctx2D.fillStyle = "#eeeeee";
      ctx2D.shadowColor = "#cccccc33";
      ctx2D.shadowBlur = 3;
      ctx2D.shadowOffsetX = 2;
      ctx2D.shadowOffsetY = 2;
      ctx2D.beginPath();
      ctx2D.roundRect(x, y, transform.dayWidth - 5, 20, 2);
      ctx2D.fill();
      ctx2D.closePath();
      ctx2D.fillStyle = "#33343c";
      ctx2D?.fillText(`${event.id} - ${event.title}`, x + 2, y + 4);
      i++;
    });
    const bitmap = canvas.transferToImageBitmap();
    j++;
    self.postMessage({ type: "day", date: date, bitmap }, [bitmap]);
    fresh.delete(date);
  }
}

self.onmessage = (message: MessageEvent) => {
  // Will have to rerender all days
  if (message.data.type === "resize") {
    if (!ctx2D) throw new Error("offscreen ctx2d not ready");
    transform.dayWidth = message.data.params.dayWidth || 100;
    transform.height = message.data.params.height;
    transform.scale = message.data.params.scale;
    renderCache();
  }
  if (message.data.type === "load") {
    if (!ctx2D) throw new Error("offscreen ctx2d not ready");
    updateCache(message.data.events, message.data.range);
  }
};
