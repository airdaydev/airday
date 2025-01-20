const canvas = new OffscreenCanvas(100, 100);
const ctx2D = canvas.getContext("2d");

console.debug("event worker ready");

// This worker prepares events for rendering & renders them to an offscreen canvas
// Range represents X clip dimension (i.e. visible days + buffer)
let range: [number, number] = [0, 0];
const idCache = new Map<string, any>();
const cache = new Map<number, Set<any>>();
const dirty = new Set<number>();

const transform = {
  dayPx: 100,
  hourPx: 25,
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

function localMidnight(date: Date) {
  const newDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  newDate.setMilliseconds(0);
  newDate.setMinutes(0);
  newDate.setHours(0);
  return newDate.valueOf();
}

function addDays(date: Date, i: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + i);
  return next;
}

function addDaysNumber(number: number, i: number) {
  return addDays(new Date(number), i).valueOf();
}

function updateCache(events: any[], cacheRange: [number, number]) {
  range = cacheRange;
  events.forEach((event) => {
    const start = Math.max(event.start, range[0] as number);
    const end = Math.min(event.end, range[1] as number);
    const startDay = localMidnight(new Date(start)).valueOf();
    const endDay = localMidnight(new Date(end)).valueOf();
    const days = Math.ceil((endDay - startDay) / 864e5) + 1;
    for (let i = 0; i < days; i++) {
      const day = addDaysNumber(startDay, 0); // utc start day
      addMapSet(cache, day, event.id);
      dirty.add(day);
      idCache.set(event.id, event);
    }
  });
  renderCache();
  for (let i = new Date(range[0]).valueOf(); i < range[1]; i = i + 864e5) {
    dirty.delete(i);
  }
}

function scale() {
  if (!ctx2D) throw new Error("offscreen ctx2d not ready");
  canvas.width = transform.dayPx * transform.scale;
  canvas.height = transform.hourPx * 25 * transform.scale;
  ctx2D.scale(transform.scale, transform.scale);
  ctx2D.textBaseline = "top";
  ctx2D.font = "8px Departure Mono";
}

function getTime(dateNum: number) {
  const date = new Date(dateNum);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function utcZeroDate(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function renderCache() {
  if (!ctx2D) throw new Error("offscreen ctx2d not ready");
  let j = 0;
  scale();
  const map = new Map();
  for (let clip = range[0]; clip <= range[1]; clip = addDaysNumber(clip, 1)) {
    if (!dirty.has(clip)) {
      // No need to rerender
      continue;
    }
    ctx2D.clearRect(0, 0, canvas.width, canvas.height);
    const events = cache.get(clip) || [];
    const posMap = new Map<string, any>();
    events.forEach((id) => {
      const event = idCache.get(id);
      const startTime = event.start < clip ? clip : event.start;
      const endTime = event.end > clip + 864e5 ? clip + 864e5 : event.end;
      const height = Math.max((endTime - startTime) / 1000 / 60, 10);
      const y = timeToY(new Date(startTime), transform.hourPx);
      const startsToday = event.start > clip;
      posMap.set(id, {
        startTime,
        endTime,
        height,
        y,
        startsToday,
      });
    });
    events.forEach((id) => {
      const event = idCache.get(id);
      const position = posMap.get(id);
      const x = 0;
      // Height calc
      // If event starts before today, event start is beginning of day
      // If event starts starts today, event is event time
      // If event ends after today, event end time is end of day
      // If event ends today, event end time is end time
      ctx2D.fillStyle = "rgb(255 240 190)";
      ctx2D.shadowColor = "#00000011";
      ctx2D.shadowBlur = 3;
      ctx2D.shadowOffsetX = 2;
      ctx2D.shadowOffsetY = 2;
      ctx2D.beginPath();
      const cornerRadii = [
        position.startsToday ? 2 : 0,
        position.startsToday ? 2 : 0,
        2,
        2,
      ];
      ctx2D.roundRect(
        x,
        position.y,
        transform.dayPx - 5,
        position.height,
        cornerRadii,
      );
      ctx2D.fill();
      ctx2D.closePath();
      ctx2D.beginPath();
      ctx2D.fillStyle = "#ffdc68";
      ctx2D.roundRect(x, position.y, 3, position.height, cornerRadii);
      ctx2D.fill();
      ctx2D.shadowColor = "#00000000";
      ctx2D.fillStyle = "rgb(152 136 102)";
      if (position.startsToday) {
        ctx2D?.fillText(`${event.title}`, x + 6, position.y + 4);
        ctx2D?.fillText(`${getTime(event.start)}`, x + 8, position.y + 4 + 16);
      }
    });
    const utcDay = utcZeroDate(new Date(clip)).valueOf();
    const bitmap = canvas.transferToImageBitmap();
    map.set(utcDay, bitmap);
    j++;
    self.postMessage({ type: "day", date: utcDay, bitmap }, [bitmap] as any);
    dirty.delete(clip);
  }
}

self.onmessage = (message: MessageEvent) => {
  // Will have to rerender all days
  if (message.data.type === "resize") {
    if (!ctx2D) throw new Error("offscreen ctx2d not ready");
    transform.dayPx = message.data.params.dayPx || 100;
    transform.hourPx = message.data.params.hourPx;
    transform.scale = message.data.params.scale;
    renderCache();
  }
  if (message.data.type === "load") {
    if (!ctx2D) throw new Error("offscreen ctx2d not ready");
    updateCache(message.data.events, message.data.range);
  }
};
