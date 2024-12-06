/**
 * Week start on Mondays (find today, then the nearest monday backwards)
 * Aim for 7 days (or drag for free movement)
 * Buffer 1 day in either direction
 * Proof of concept: Use BIG canvas OR let canvas follow scroll (but account for jump)?
 * Show grid
 */

export class Cal {
  canvas?: HTMLCanvasElement;
  ctx2D?: CanvasRenderingContext2D;
  scale = window.devicePixelRatio || 1;
  constructor() {}
  mount(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx2D = this.canvas.getContext("2d");
    if (ctx2D) {
      this.ctx2D = ctx2D;
    } else {
      throw new Error("Failed to retrieve canvas context");
    }
    this.resizeCanvas();
    this.frame();
  }
  get dimensions() {
    if (!this.canvas)
      throw new Error("Attempted to get non-existent canvas dimensions");
    return [this.canvas.width / this.scale, this.canvas.height / this.scale];
  }
  resizeCanvas = () => {
    if (!this.canvas || !this.ctx2D) return;
    console.log(this.canvas);
    this.canvas.width = this.canvas.offsetWidth * this.scale;
    this.canvas.height = this.canvas.offsetHeight * this.scale;
    this.ctx2D.scale(this.scale, this.scale);
  };
  frame() {
    requestAnimationFrame((frame) => {
      if (!this.ctx2D) {
        console.warn("Attempted to call frame while canvas not instantiated");
        return;
      }
      this.ctx2D.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
      this.times();
      this.day();
      this.frame();
    });
  }
  times() {
    // Z offset required
    // 00:00-24:00
  }
  day() {
    this.dayLabel();
  }
  dayLabel() {
    this.ctx2D.fillStyle = "black";
    this.ctx2D.font = "12px Alte Haas Grotesk";
    this.ctx2D.textAlign = "center";
    this.ctx2D.fillText(`Mo 30`, 50, 25);
  }
  cleanUp() {}
}
