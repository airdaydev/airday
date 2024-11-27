import { TreeContext } from "./dnd-context";

interface TreeCanvasOpts {
  treeContext: TreeContext;
  canvasRef: HTMLCanvasElement;
}

export type RGB = [number, number, number];

class FPS {
  sampleSize = 60;
  samples: number[] = [];
  lastTime = performance.now();
  frameCount = 0;
  constructor(sampleSize = 60) {
    if (sampleSize) this.sampleSize = sampleSize;
  }

  update() {
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    this.frameCount++;
    if (this.frameCount === 1) return 0;

    this.samples.push(1000 / deltaTime);
    if (this.samples.length > this.sampleSize) {
      this.samples.shift();
    }

    const average =
      this.samples.reduce((sum, fps) => sum + fps, 0) / this.samples.length;
    return Math.round(average);
  }
}

interface RowRecord {
  start: number;
  last: number;
}

export class TreeCanvas {
  treeContext: TreeContext;
  canvasEl?: HTMLCanvasElement;
  ctx2D?: CanvasRenderingContext2D;
  scale = window.devicePixelRatio || 1;
  fps = new FPS();
  currentRow?: number;
  shadowColor: RGB = [240, 240, 240];
  rowsHighlighted = new Map<number, RowRecord>(); // Fades in over 100ms, fades out after 100ms

  constructor(opts: TreeCanvasOpts) {
    this.treeContext = opts.treeContext;
    this.canvasEl = opts.canvasRef;
    const ctx2D = this.canvasEl.getContext("2d");
    if (ctx2D) {
      this.ctx2D = ctx2D;
    } else {
      throw new Error("Failed to retrieve canvasEl context");
    }
    this.resizeCanvas();
    this.initRenderLoop();
  }
  setShadowColor = (color: RGB) => {
    this.shadowColor = color;
  };
  resizeCanvas = () => {
    if (!this.canvasEl || !this.ctx2D) return;
    this.canvasEl.width = this.canvasEl.offsetWidth * this.scale;
    this.canvasEl.height = this.canvasEl.offsetHeight * this.scale;
    this.ctx2D.scale(this.scale, this.scale);
  };
  get dimensions() {
    // TODO: Cache
    return [
      this.canvasEl.width / this.scale,
      this.canvasEl.height / this.scale,
    ];
  }
  initRenderLoop() {
    this.frame();
  }
  // bg() {
  //   this.ctx2D.fillStyle = "#f0f0f0";
  //   this.ctx2D.fillRect(0, 0, this.dimensions[0], this.dimensions[1]);
  //   this.ctx2D.fillStyle = "black";
  // }
  frame() {
    requestAnimationFrame((frame) => {
      this.ctx2D.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
      const fps = this.fps.update();
      this.ctx2D.font = "12px Alte Haas Grotesk";
      this.ctx2D.textAlign = "right";
      this.ctx2D.fillText(
        `FPS: ${fps}`,
        this.dimensions[0] - 2,
        this.dimensions[1] - 4,
      );
      this.frame();
      const row = this.treeContext.rowDraggedOver[0]();
      if (typeof row === "number") {
        this.addShadow(frame, row);
      } else {
        this.currentRow = undefined;
      }
      this.renderShadows(frame);
    });
  }
  addShadow(frame: number, index: number) {
    this.currentRow = index;
    const row = this.rowsHighlighted.get(index);
    if (!row) {
      this.rowsHighlighted.set(index, { start: frame, last: frame });
    } else {
      this.rowsHighlighted.set(index, { ...row, last: frame });
    }
  }
  renderShadows(frame: number) {
    const itemHeight = this.treeContext.itemHeight;
    for (const row of this.rowsHighlighted.entries()) {
      let opacity = 0;
      if (this.currentRow === row[0]) {
        // Fading in or full
        const elapsed = frame - row[1].start;
        opacity = elapsed > 150 ? 1 : elapsed / 150;
      } else {
        // Fading out
        const elapsed = frame - row[1].last;
        opacity = 1 - elapsed / 150;
      }
      this.ctx2D.fillStyle = `rgba(${this.shadowColor[0]}, ${this.shadowColor[1]}, ${this.shadowColor[2]}, ${opacity})`;
      this.ctx2D.fillRect(
        0,
        row[0] * itemHeight - this.treeContext.scrollOffset[0](),
        this.dimensions[0],
        itemHeight,
      );
      if (frame - row[1].last > 150) {
        this.rowsHighlighted.delete(row[0]);
      }
    }
  }
}
