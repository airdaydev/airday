const getStartOfWeek = (date: Date) => {
  const dayOfWeek = date.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayDate = new Date(date);
  mondayDate.setHours(0);
  mondayDate.setMinutes(0);
  mondayDate.setSeconds(0);
  mondayDate.setDate(date.getDate() - daysSinceMonday);
  return mondayDate;
};

const getDate = (date: Date) => {
  const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const day = days[date.getDay()];
  const dateMonth = date.getDate();
  const mo = date.getMonth();
  const year = date.getFullYear();
  return `${day} ${dateMonth.toString().padStart(2, "0")}/${mo + 1}/${year}`;
};

const relativeDay = (dateVal: number, relativeDays: number) => {
  return new Date(dateVal + relativeDays * 864e5);
};

const getDateArray = (startDate: number, dayCount: number): Date[] => {
  let arr: Date[] = [];
  for (let i = 0; i < dayCount; i++) {
    arr.push(relativeDay(startDate, i));
  }
  return arr;
};

function getCanvasContext(canvas: HTMLCanvasElement) {
  const ctx2D = canvas.getContext("2d");
  if (!ctx2D) {
    throw new Error("Failed to retrieve canvas context");
  }
  return ctx2D;
}

function isWeekend(date: Date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

const defaultContainerWidth = 100000;
const scale = window.devicePixelRatio || 1;

function resizeCanvas(canvas: HTMLCanvasElement) {
  canvas.width = canvas.offsetWidth * scale;
  canvas.height = canvas.offsetHeight * scale;
  const ctx2D = getCanvasContext(canvas);
  ctx2D.scale(scale, scale);
}

function dimensions(canvas: HTMLCanvasElement) {
  if (!canvas)
    throw new Error("Attempted to get non-existent canvas dimensions");
  return [canvas.width / scale, canvas.height / scale];
}

function clearCanvas(canvas: HTMLCanvasElement) {
  const canvasDimensions = dimensions(canvas);
  getCanvasContext(canvas).clearRect(
    0,
    0,
    canvasDimensions[0],
    canvasDimensions[1],
  );
}

const foxPng = "https://minio.gormly.co/airday/fox.png";

interface ColourScheme {
  bg: string;
  hzLine: string;
  vtLine: string;
  color: string;
  labels: string;
  shade: string;
}

const lightScheme: ColourScheme = {
  bg: "white",
  color: "#000000",
  labels: "#777",
  hzLine: "#eee",
  vtLine: "#ddd",
  shade: "#f7f7f7",
};

const darkScheme: ColourScheme = {
  bg: "black",
  color: "#fff",
  labels: "#333",
  hzLine: "#222",
  vtLine: "#222",
  shade: "#111111aa",
};

type TimeFormat = "24hr" | "12hr";

class CalendarTransform {
  offset = [0, 0]; // Scroll offset
  hourPx = 50; // 1 hour = 50px
  renderer: CalRenderer;
  constructor(renderer: CalRenderer) {
    this.renderer = renderer;
  }
  get hourViewBuffer() {
    // Hours visible outside view in each direction (-/+)
    return this.hourPx * 2;
  }
  getVisibleHours() {
    const minYClip = this.offset[1] - this.hourViewBuffer;
    const r = minYClip % this.hourPx;
    const firstHourPx = this.hourPx - r; // The first hour position within clip space
    const firstHour = (minYClip + firstHourPx) / this.hourPx;
    return [firstHour, firstHourPx - this.hourViewBuffer];
  }
  hoursVisible(viewportHeight: number) {
    return Math.floor((viewportHeight + this.hourViewBuffer * 2) / this.hourPx);
  }
  getClipspaceDay() {
    const minXClip = this.offset[0] - this.renderer.dayColWidth; // 1 day buffer behind offset in screen space
    const r = minXClip % this.renderer.dayColWidth;
    const firstDayPx =
      minXClip - r - this.offset[0] + this.renderer.gridOffset[0]; // The first day position within clip space
    const firstDay = (firstDayPx + this.offset[0]) / this.renderer.dayColWidth;
    return [firstDay, firstDayPx];
  }
  timeToY(date: Date) {
    const hours = date.getHours() * this.hourPx;
    const min = (date.getMinutes() * this.hourPx) / 60;
    return hours + min - this.offset[1] + this.renderer.gridOffset[1];
  }
  maxYOffset() {
    return Math.max(
      0,
      this.renderer.scrollHeight - this.renderer.canvas.clientHeight,
    );
  }
  addDelta(x: number, y: number) {
    this.offset[0] = this.offset[0] + x;
    this.offset[1] = Math.min(
      Math.max(this.offset[1] + y, 0),
      this.maxYOffset(),
    );
  }
  xStart(x: number) {
    const r = (x % this.renderer.gridOffset[0]) + this.offset[0];
    return x - r;
  }
  yToTime(y: number) {}
  xToDay(x: number) {
    return Math.floor(
      (x - this.renderer.gridOffset[0] + this.offset[0]) /
        this.renderer.dayColWidth,
    );
  }
  coordsToDate() {}
  // dayToX(date: Date) {

  // }
}

const TIME_FONT_SIZE = 11;
const DAY_BUFFER_LENGTH = 50; // 49-1-50
const DAY_BUFFER_RESET = 25;

// Virtual calendar view: Reset origin at each DAY_BUFFER days start day
// Reset origin RESET_POINT days out either direction
// scroll auto snaps to nearest day

const iconCache = new Map<string, ImageBitmap>();

export class CalRenderer {
  scrollable: HTMLDivElement;
  scrollChild: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx2D: CanvasRenderingContext2D;
  containerWidth = defaultContainerWidth;
  colourScheme = lightScheme;
  timeColWidth = 50;
  dayColWidth = 100;
  headerHeight = 50; // aka header height
  allDayRowHeight = 50;
  transform: CalendarTransform;
  timeFormat: TimeFormat = "24hr";
  margin = 10;
  resized = false;
  originDate = getStartOfWeek(new Date());
  lastAction: number = performance.now();
  autoscrolling = false;
  constructor(container: HTMLDivElement) {
    this.transform = new CalendarTransform(this);
    const { scrollable, scrollChild, canvas, ctx2D } = this.mount(container);
    this.scrollable = scrollable;
    this.canvas = canvas;
    this.scrollChild = scrollChild;
    this.scrollChild.style.height = `${this.scrollHeight}px`; // Additional px to display 24:00
    this.ctx2D = ctx2D;
    this.resizeCanvas();
    this.frame();
    // TODO: Destroy
    const resizeObserver = new ResizeObserver(() => {
      this.resized = true;
      this.act();
    });
    resizeObserver.observe(canvas);
    scrollable.addEventListener("scroll", (event) => {
      event.preventDefault();
    });
    scrollable.addEventListener("wheel", (event: WheelEvent) => {
      this.transform.addDelta(event.deltaX, event.deltaY);
      this.act();
    });
    scrollable.addEventListener("mousemove", (event) => {
      // console.log(this.transform.xToDay(event.x));
    });
    this.resizeCanvas();
    this.frame();
    this.goToDate();
  }
  loadPng = async (url: string) => {
    const data = await fetch(url);
    const blob = await data.blob();
    const bmp = await createImageBitmap(blob);
    iconCache.set(url, bmp);
  };
  mount = (container: HTMLElement) => {
    // Scrollable area
    const scrollable = document.createElement("div");
    scrollable.id = "airday_scrollable";
    scrollable.style.position = "absolute";
    scrollable.style.top = "0";
    scrollable.style.left = "0";
    scrollable.style.width = "100%";
    scrollable.style.height = "100%";
    scrollable.style.overflowY = "scroll";
    scrollable.style.zIndex = "2";
    scrollable.style.overscrollBehaviorY = "none";
    // Scrolling content (empty)
    const scrollChild = document.createElement("div");
    scrollChild.id = "airday_scroll_child";
    scrollChild.style.width = "100%";
    // Canvas (sits behind)
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const ctx2D = getCanvasContext(canvas);
    // Attach everything
    scrollable.append(scrollChild);
    container.appendChild(scrollable);
    container.appendChild(canvas);
    return {
      scrollable,
      scrollChild,
      canvas,
      ctx2D,
    };
  };
  changeTheme = (theme: "dark" | "light") => {
    if (theme === "dark") {
      this.colourScheme = darkScheme;
    } else if (theme === "light") {
      this.colourScheme = lightScheme;
    }
    this.act();
  };
  get scrollHeight() {
    return this.transform.hourPx * 24 + this.gridOffset[1] + TIME_FONT_SIZE;
  }
  act = () => (this.lastAction = performance.now());
  // Resets origin and puts date arg at DAY_BUFFER_LENGTH*dayColWidth
  goToDate = (date: Date = getStartOfWeek(new Date())) => {
    this.originDate = new Date(date.valueOf()); // 1 year ago
    console.log("this.originDate", this.originDate);
    this.scrollable.scrollTo(DAY_BUFFER_LENGTH * this.dayColWidth, 0);
  };
  // Fit canvas matrix to canvas px dimensions
  resizeCanvas = () => {
    resizeCanvas(this.canvas);
    this.dayColWidth = (this.canvas.offsetWidth - this.timeColWidth) / 7;
    this.resized = false;
  };
  get gridOffset() {
    return [this.timeColWidth, this.headerHeight + this.allDayRowHeight];
  }
  draw() {
    if (this.resized) {
      this.resizeCanvas();
    }
    clearCanvas(this.canvas);
    const [startDay, startDayPx] = this.transform.getClipspaceDay();
    const dates = getDateArray(
      this.originDate.valueOf() + startDay * 864e5,
      12,
    );
    this.days(dates, startDayPx);
    this.times();
    this.header();
    this.debug();
    const fox = iconCache.get(foxPng);
    if (fox) {
      this.ctx2D.drawImage(fox, 100, 200, 150, 150);
    }
  }
  frame() {
    requestAnimationFrame(() => {
      if (performance.now() - this.lastAction < 1000) {
        this.draw();
      }
      this.frame();
    });
  }
  header() {
    // bg optional
    // this.ctx2D.fillStyle = this.colourScheme.bg;
    // this.ctx2D.fillRect(0, 0, this.canvas.width, this.gridOffset[1]);
    this.allDayLabel();
    this.hzLine(this.headerHeight);
    this.hzLine(this.gridOffset[1]);
  }
  times() {
    this.ctx2D.textAlign = "right";
    this.ctx2D.textBaseline = "middle";
    this.ctx2D.fillStyle = this.colourScheme.labels;
    this.ctx2D.font = `${TIME_FONT_SIZE}px Alte Haas Grotesk`;
    const [firstHour, firstHourPx] = this.transform.getVisibleHours();
    let pxOffset = firstHourPx + this.gridOffset[1];
    this.ctx2D.save();
    const path = new Path2D();
    path.rect(
      0,
      this.gridOffset[1],
      this.canvas.offsetWidth,
      this.canvas.offsetHeight,
    );
    this.ctx2D.clip(path);
    for (
      let i = firstHour;
      i <=
      firstHour + this.transform.hoursVisible(this.scrollable.offsetHeight);
      i++
    ) {
      if (i >= 1 && i <= 24) {
        this.ctx2D.fillText(
          `${i.toString().padStart(2, "0")}:00`,
          this.timeColWidth - this.margin,
          pxOffset,
        );
      }
      this.hzLine(pxOffset);
      pxOffset += this.transform.hourPx;
    }
    this.ctx2D.restore();
  }
  days(dates: Date[], offsetPx: number) {
    this.ctx2D.save();
    const path = new Path2D();
    path.rect(
      this.gridOffset[0],
      0,
      this.canvas.offsetWidth,
      this.canvas.offsetHeight,
    );
    this.ctx2D.clip(path);
    dates.map((date, index) => {
      const offset = index * this.dayColWidth + offsetPx;
      if (isWeekend(date)) {
        // Weekend shading
        this.ctx2D.fillStyle = this.colourScheme.shade;
        this.ctx2D.fillRect(
          offset,
          0,
          this.dayColWidth,
          this.canvas.offsetHeight,
        );
      }
      this.vtLine(offset, 0);
      this.dayLabel(date, offset);
    });
    this.ctx2D.restore();
  }
  allDayLabel() {
    this.ctx2D.fillStyle = this.colourScheme.color;
    this.ctx2D.font = "12px Alte Haas Grotesk";
    this.ctx2D.textAlign = "right";
    this.ctx2D.textBaseline = "middle";
    this.ctx2D.fillStyle = this.colourScheme.labels;
    this.ctx2D.fillText(
      "All day",
      this.timeColWidth - this.margin,
      this.headerHeight + this.allDayRowHeight / 2,
    );
  }
  dayLabel(date: Date, offset: number) {
    const text = getDate(date);
    this.ctx2D.fillStyle = this.colourScheme.color;
    this.ctx2D.font = "12px Alte Haas Grotesk";
    const textWidth = this.ctx2D.measureText(text).width;
    const padding = (this.dayColWidth - textWidth) / 2;
    this.ctx2D.textAlign = "left";
    this.ctx2D.fillText(text, offset + padding, 25);
  }
  hzLine(yOffset: number) {
    this.ctx2D.strokeStyle = this.colourScheme.hzLine;
    this.ctx2D.beginPath();
    this.ctx2D.lineWidth = 1;
    this.ctx2D.moveTo(this.timeColWidth, yOffset);
    this.ctx2D.lineTo(this.canvas?.offsetWidth, yOffset);
    this.ctx2D.stroke();
  }
  vtLine(xOffset: number, yStart: number) {
    this.ctx2D.strokeStyle = this.colourScheme.vtLine;
    this.ctx2D.beginPath();
    this.ctx2D.lineWidth = 0.75;
    this.ctx2D.moveTo(xOffset, yStart);
    this.ctx2D.lineTo(xOffset, this.canvas?.offsetHeight);
    this.ctx2D.stroke();
  }
  debug() {
    this.ctx2D.textAlign = "right";
    this.ctx2D.fillText(
      `Offset: ${this.transform.offset}`,
      this.canvas.offsetWidth - this.margin,
      this.canvas?.offsetHeight - 12,
    );
  }
  cleanUp() {}
}
