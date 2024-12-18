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
  hzLine: string;
  vtLine: string;
  color: string;
  labels: string;
}

const defaultColourScheme: ColourScheme = {
  color: "#000000",
  labels: "#888",
  hzLine: "#eee",
  vtLine: "#ddd",
};

type TimeFormat = "24hr" | "12hr";

class CalendarTransform {
  origin = 0; // i.e. day
  offset = [0, 0];
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
  timeToY(date: Date) {
    const hours = date.getHours() * this.hourPx;
    const min = (date.getMinutes() * this.hourPx) / 60;
    return hours + min - this.offset[1];
  }
  YToTime() {}
  XToDay() {}
  DayToX() {}
}

export class CalRenderer {
  container: HTMLDivElement;
  domContainer: HTMLDivElement;
  canvas: HTMLCanvasElement;
  headerCanvas: HTMLCanvasElement;
  ctx2D: CanvasRenderingContext2D;
  headerCtx2D: CanvasRenderingContext2D;
  containerWidth = defaultContainerWidth;
  colourScheme = defaultColourScheme;
  timeColWidth = 50;
  dayColWidth = 100;
  gridOffset = 0;
  transform = new CalendarTransform();
  timeFormat: TimeFormat = "24hr";
  scrollOffset = [defaultContainerWidth / 2, 0];
  // dayAnchor;
  margin = 10;
  resized = false;
  zeroDate = getStartOfWeek(new Date());
  constructor(mntParams: {
    container: HTMLDivElement;
    domContainer: HTMLDivElement;
    headerCanvas: HTMLCanvasElement;
    canvas: HTMLCanvasElement;
  }) {
    this.container = mntParams.container;
    this.headerCanvas = mntParams.headerCanvas;
    this.canvas = mntParams.canvas;
    this.domContainer = mntParams.domContainer;
    this.domContainer.style.height = `${this.transform.hourPx * 25}px`;
    this.ctx2D = getCanvasContext(this.canvas);
    this.headerCtx2D = getCanvasContext(this.headerCanvas);
    this.resizeCanvas();
    this.frame();
    window.addEventListener("resize", () => (this.resized = true));
    this.container.addEventListener("scroll", () => {
      this.transform.offset[1] = this.container.scrollTop;
    });
    this.resizeCanvas();
    this.frame();
  }
  // Fit canvas matrix to canvas px dimensions
  resizeCanvas = () => {
    resizeCanvas(this.canvas);
    resizeCanvas(this.headerCanvas);
    this.dayColWidth = Math.max(
      (this.canvas.offsetWidth - this.timeColWidth) / 7,
      100,
    );
    this.resized = false;
  };
  draw() {
    if (this.resized) {
      this.resizeCanvas();
    }
    clearCanvas(this.headerCanvas);
    clearCanvas(this.canvas);
    this.day();
    this.allDayLabel();
    this.times();
    this.hzLine(this.headerCtx2D, 25 + this.margin);
    this.hzLine(this.headerCtx2D, dimensions(this.headerCanvas)[1] - 1);
  }
  frame() {
    requestAnimationFrame(() => {
      this.draw();
      this.frame();
    });
  }
  times() {
    this.ctx2D.textAlign = "right";
    this.ctx2D.textBaseline = "middle";
    this.ctx2D.fillStyle = this.colourScheme.labels;
    this.ctx2D.font = "11px Alte Haas Grotesk";
    const [firstHour, firstHourPx] = this.transform.getVisibleHours();
    let pxOffset = firstHourPx;
    for (
      let i = firstHour;
      i <= firstHour + this.transform.hoursVisible(this.container.offsetHeight);
      i++
    ) {
      if (i >= 1 && i <= 24) {
        this.ctx2D.fillText(
          `${i.toString().padStart(2, "0")}:00`,
          this.timeColWidth - this.margin,
          pxOffset,
        );
      }
      this.hzLine(this.ctx2D, pxOffset);
      pxOffset += this.transform.hourPx;
    }
  }
  day() {
    const dates = getDateArray(this.zeroDate.valueOf(), 7);
    dates.map((date, index) => {
      const offset = this.timeColWidth + index * this.dayColWidth;
      if (isWeekend(date)) {
        // Weekend shading
        this.ctx2D.fillStyle = "#f7f7f7";
        this.ctx2D.fillRect(
          offset,
          0,
          this.dayColWidth,
          this.canvas.offsetHeight,
        );
        this.headerCtx2D.fillStyle = "#f7f7f7";
        this.headerCtx2D.fillRect(
          offset,
          this.margin + 25,
          this.dayColWidth,
          this.canvas.offsetHeight,
        );
      }
      this.dayLabel(date, offset);
      this.vtLine(this.ctx2D, offset, 0);
      this.vtLine(this.headerCtx2D, offset, this.margin + 25);
    });
  }
  allDayLabel() {
    this.headerCtx2D.fillStyle = this.colourScheme.color;
    this.headerCtx2D.font = "12px Alte Haas Grotesk";
    this.headerCtx2D.textAlign = "right";
    this.headerCtx2D.textBaseline = "middle";
    this.headerCtx2D.fillStyle = this.colourScheme.labels;
    this.headerCtx2D.fillText("all-day", this.timeColWidth - this.margin, 55); // TODO: Fix magic number
  }
  dayLabel(date: Date, offset: number) {
    const text = getDate(date);
    this.headerCtx2D.fillStyle = this.colourScheme.color;
    this.headerCtx2D.font = "12px Alte Haas Grotesk";
    const textWidth = this.headerCtx2D.measureText(text).width;
    const padding = (this.dayColWidth - textWidth) / 2;
    this.headerCtx2D.textAlign = "left";
    this.headerCtx2D.fillText(text, offset + padding, 25);
  }
  hzLine(ctx: CanvasRenderingContext2D, yOffset: number) {
    ctx.strokeStyle = this.colourScheme.hzLine;
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.moveTo(this.timeColWidth, yOffset);
    ctx.lineTo(this.canvas?.offsetWidth, yOffset);
    ctx.stroke();
  }
  vtLine(ctx: CanvasRenderingContext2D, xOffset: number, yStart: number) {
    ctx.strokeStyle = this.colourScheme.vtLine;
    ctx.beginPath();
    ctx.lineWidth = 0.75;
    ctx.moveTo(xOffset, yStart);
    ctx.lineTo(xOffset, this.canvas?.offsetHeight);
    ctx.stroke();
  }
  cleanUp() {}
}
