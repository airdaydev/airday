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

export class CalRenderer {
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  headerCanvas: HTMLCanvasElement;
  ctx2D: CanvasRenderingContext2D;
  headerCtx2D: CanvasRenderingContext2D;
  containerWidth = defaultContainerWidth;
  timeColWidth = 50;
  dayColWidth = 100;
  gridOffset = 0;
  scrollOffset = [defaultContainerWidth / 2, 0];
  // dayAnchor;
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
      this.scrollOffset = [this.container.scrollLeft, this.container.scrollTop];
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
    this.canvas.style.top = `${this.scrollOffset[1]}px`;
    clearCanvas(this.headerCanvas);
    clearCanvas(this.canvas);
    this.times();
    this.day();
    this.hzLine(this.headerCtx2D, 25 + this.margin);
    this.hzLine(this.headerCtx2D, dimensions(this.headerCanvas)[1] - 1);
  }
  frame() {
    requestAnimationFrame((frame) => {
      this.draw();
      this.frame();
    });
  }
  times() {
    const space = 50;
    this.ctx2D.textAlign = "right";
    this.ctx2D.textBaseline = "middle";
    this.ctx2D.fillStyle = "#888";
    this.ctx2D.font = "11px Alte Haas Grotesk";
    const d = dimensions(this.canvas);
    const y = this.scrollOffset[1];
    const r = y % space;
    const start = y - r;
    const end = start + d[1];
    console.log(start, end);
    for (let i = start; i <= end; i++) {
      this.ctx2D.fillText(
        `${i.toString().padStart(2, "0")}:00`,
        this.timeColWidth - this.margin,
        space * i,
      );
      this.hzLine(this.ctx2D, space * i);
    }
  }
  day() {
    const dates = getDateArray(this.zeroDate.valueOf(), 7);
    dates.map((date, index) => {
      const offset = this.timeColWidth + index * this.dayColWidth;
      this.dayLabel(date, offset);
      this.vtLine(this.ctx2D, offset, 0);
      this.vtLine(this.headerCtx2D, offset, this.margin + 25);
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
  hzLine(ctx: CanvasRenderingContext2D, yOffset: number) {
    ctx.strokeStyle = "#eee";
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.moveTo(this.timeColWidth, yOffset);
    ctx.lineTo(this.canvas?.offsetWidth, yOffset);
    ctx.stroke();
  }
  vtLine(ctx: CanvasRenderingContext2D, xOffset: number, yStart: number) {
    ctx.strokeStyle = "#ddd";
    ctx.beginPath();
    ctx.lineWidth = 0.75;
    ctx.moveTo(xOffset, yStart);
    ctx.lineTo(xOffset, this.canvas?.offsetHeight);
    ctx.stroke();
  }
  cleanUp() {}
}
