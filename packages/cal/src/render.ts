const getStartOfWeek = (date: Date) => {
  const dayOfWeek = date.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayDate = new Date(date);
  mondayDate.setDate(date.getDate() - daysSinceMonday);
  return mondayDate;
};

const getDate = (date: Date) => {
  const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const day = days[date.getDay()];
  const dateMonth = date.getDate();
  return `${day} ${dateMonth.toString().padStart(2, "0")}`;
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
  gridOffset = [0, 50]; // Initial offset (accounting for header etc)
  offset = [0, 0]; // Scroll offset
  hourPx = 50; // 1 hour = 50px
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
  getVisibleDays(dayPx: number = 100) {
    const minXClip = this.offset[0] - dayPx * 2;
    const r = minXClip % dayPx;
    const firstDayPx = dayPx - r; // The first hour position within clip space
    const firstDay = (minXClip + firstDayPx) / dayPx;
    return [firstDay, firstDayPx - this.hourViewBuffer];
  }
  timeToY(date: Date) {
    const hours = date.getHours() * this.hourPx;
    const min = (date.getMinutes() * this.hourPx) / 60;
    return hours + min - this.offset[1] + this.gridOffset[0];
  }
  YToTime() {}
  XToDay() {}
  DayToX() {}
}

const TIME_FONT_SIZE = 11;

// Virtual calendar view: Reset origin at each 60 days start day (30 days in each direction)
// Reset origin 20 days out either direction
// scroll auto snaps to nearest day

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
  transform = new CalendarTransform();
  timeFormat: TimeFormat = "24hr";
  margin = 10;
  resized = false;
  originDate = getStartOfWeek(new Date());
  lastAction: number = performance.now();
  constructor(container: HTMLDivElement) {
    const { scrollable, scrollChild, canvas, ctx2D } = this.mount(container);
    this.scrollable = scrollable;
    this.canvas = canvas;
    this.scrollChild = scrollChild;
    this.scrollChild.style.height = `${this.transform.hourPx * 24 + this.gridOffset[1] + TIME_FONT_SIZE}px`; // Additional px to display 24:00
    this.ctx2D = ctx2D;
    this.resizeCanvas();
    this.frame();
    window.addEventListener("resize", () => {
      this.resized = true;
      this.act();
    });
    scrollable.addEventListener("scroll", () => {
      this.act();
      this.transform.offset = [
        this.scrollable.scrollLeft,
        this.scrollable.scrollTop,
      ];
    });
    this.resizeCanvas();
    this.frame();
    this.goToDate();
  }
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
    scrollable.style.zIndex = "10";
    scrollable.style.overscrollBehaviorY = "none";
    // Scrolling content (empty)
    const scrollChild = document.createElement("div");
    scrollChild.id = "airday_scroll_child";
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
  act = () => (this.lastAction = performance.now());
  // Resets origin and puts date arg at 365*dayColWidth
  goToDate = (date: Date = getStartOfWeek(new Date())) => {
    this.resizeCanvas();
    this.originDate = new Date(date.valueOf() - 365 * 864e5); // 1 year ago
    this.scrollable.scrollTo(365 * this.dayColWidth, 0);
  };
  // Fit canvas matrix to canvas px dimensions
  resizeCanvas = () => {
    resizeCanvas(this.canvas);
    this.dayColWidth = (this.canvas.offsetWidth - this.timeColWidth) / 7;
    this.scrollChild.style.width = `${365 * 2 * this.dayColWidth}px`;
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
    const [startDay, startDayPx] = this.transform.getVisibleDays(
      this.dayColWidth,
    );
    const dates = getDateArray(this.originDate.valueOf() + startDay * 864e5, 7);
    this.days(dates, startDayPx);
    this.times();
    this.header();
    this.debug();
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
      const offset = this.timeColWidth + index * this.dayColWidth + offsetPx;
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
