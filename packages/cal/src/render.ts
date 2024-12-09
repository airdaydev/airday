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

export class Cal {
  container?: HTMLElement;
  canvas?: HTMLCanvasElement;
  _ctx2D?: CanvasRenderingContext2D;
  scale = window.devicePixelRatio || 1;
  timeColWidth = 50;
  dayColWidth = 100;
  gridOffset = 0;
  scrollTopOffset = 0;
  margin = 10;
  resized = false;
  zeroDate = getStartOfWeek(new Date());
  constructor() {}
  get ctx2D() {
    if (!this._ctx2D) {
      throw new Error("CanvasRenderingContext2D doesn't exist");
    }
    return this._ctx2D;
  }
  mount(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.container = container;
    this.canvas = canvas;
    const ctx2D = this.canvas.getContext("2d");
    if (ctx2D) {
      this._ctx2D = ctx2D;
    } else {
      throw new Error("Failed to retrieve canvas context");
    }
    this.resizeCanvas();
    this.frame();
    window.addEventListener("resize", () => (this.resized = true));
    container.addEventListener("scroll", (event) => {
      this.scrollTopOffset = container.scrollTop;
    });
  }
  get dimensions() {
    if (!this.canvas)
      throw new Error("Attempted to get non-existent canvas dimensions");
    return [this.canvas.width / this.scale, this.canvas.height / this.scale];
  }
  resizeCanvas = () => {
    if (!this.canvas || !this.ctx2D) return;
    this.canvas.width = this.canvas.offsetWidth * this.scale;
    this.canvas.height = this.canvas.offsetHeight * this.scale;
    this.ctx2D.scale(this.scale, this.scale);
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
    this.canvas.style.top = `${this.scrollTopOffset}px`;
    this.ctx2D.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
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
    this.ctx2D.font = "14px Alte Haas Grotesk";
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
      this.dayLabel(date, this.timeColWidth + index * this.dayColWidth);
    });
  }
  dayLabel(date: Date, offset: number) {
    const text = getDate(date);
    this.ctx2D.fillStyle = "black";
    this.ctx2D.font = "14px Alte Haas Grotesk";
    const textWidth = this.ctx2D.measureText(text).width;
    const padding = (this.dayColWidth - textWidth) / 2;
    this.ctx2D.textAlign = "left";
    this.ctx2D.fillText(text, offset + padding, 25);
    this.vtLine(offset, 25 + this.margin);
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
