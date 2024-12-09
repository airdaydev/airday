/**
 * Week starts 1 day before today
 * Aim for 7 days (+ drag for free movement)
 * Buffer 1 day in either direction
 * Show grid
 */

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

export class Cal {
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  headerCanvas: HTMLCanvasElement;
  ctx2D: CanvasRenderingContext2D;
  headerCtx2D: CanvasRenderingContext2D;
  containerWidth = defaultContainerWidth;
  timeColWidth = 50;
  dayColWidth = 100;
  gridOffset = 0;
  scrollOffset = [0, defaultContainerWidth / 2];
  margin = 10;
  resized = false;
  zeroDate = getStartOfWeek(new Date());
  constructor(mntParams: {
    container: HTMLDivElement;
    headerCanvas: HTMLCanvasElement;
    canvas: HTMLCanvasElement;
  }) {
    this.container = mntParams.container;
    this.headerCanvas = mntParams.headerCanvas;
    this.canvas = mntParams.canvas;
    this.ctx2D = getCanvasContext(this.canvas);
    this.headerCtx2D = getCanvasContext(this.headerCanvas);
    this.resizeCanvas();
    this.frame();
    window.addEventListener("resize", () => (this.resized = true));
    this.container.addEventListener("scroll", (event) => {
      this.scrollOffset = [this.container.scrollTop, this.container.scrollLeft];
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
    this.canvas.style.top = `${this.scrollOffset[0]}px`;
    clearCanvas(this.canvas);
    clearCanvas(this.headerCanvas);
    this.times();
    this.day();
    this.hzLine(25 + this.margin);
  }
  frame() {
    requestAnimationFrame((frame) => {
      if (!this.ctx2D) {
        console.warn("Attempted to call frame while canvas not instantiated");
        return;
      }
      this.draw();
      this.frame();
    });
  }
  times() {
    const start = 50 + this.margin;
    const space = 50;
    this.ctx2D.textAlign = "right";
    this.ctx2D.textBaseline = "middle";
    this.ctx2D.fillStyle = "#888";
    this.ctx2D.font = "11px Alte Haas Grotesk";
    for (let i = 0; i <= 24; i++) {
      this.ctx2D.fillText(
        `${i.toString().padStart(2, "0")}:00`,
        this.timeColWidth - this.margin,
        start + space * i,
      );
      this.hzLine(start + space * i);
    }
    // Z offset required
    // 00:00-24:00
  }
  day() {
    const dates = getDateArray(this.zeroDate.valueOf(), 7);
    dates.map((date, index) => {
      const offset = this.timeColWidth + index * this.dayColWidth;
      this.dayLabel(date, offset);
      this.vtLine(offset, 25 + this.margin);
    });
  }
  dayLabel(date: Date, offset: number) {
    const text = getDate(date);
    this.headerCtx2D.fillStyle = "black";
    this.headerCtx2D.font = "12px Alte Haas Grotesk";
    const textWidth = this.headerCtx2D.measureText(text).width;
    const padding = (this.dayColWidth - textWidth) / 2;
    this.headerCtx2D.textAlign = "left";
    this.headerCtx2D.fillText(text, offset + padding, 25);
  }
  hzLine(yOffset: number) {
    this.ctx2D.strokeStyle = "#eee";
    this.ctx2D.beginPath();
    this.ctx2D.lineWidth = 1;
    this.ctx2D.moveTo(this.timeColWidth, yOffset);
    this.ctx2D.lineTo(this.canvas?.offsetWidth, yOffset);
    this.ctx2D.stroke();
  }
  vtLine(xOffset: number, yStart: number) {
    this.ctx2D.strokeStyle = "#ddd";
    this.ctx2D.beginPath();
    this.ctx2D.lineWidth = 0.75;
    this.ctx2D.moveTo(xOffset, yStart);
    this.ctx2D.lineTo(xOffset, this.canvas?.offsetHeight);
    this.ctx2D.stroke();
  }
  cleanUp() {}
}
