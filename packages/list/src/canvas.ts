import { TreeContext } from "./dnd-context";

interface TreeCanvasOpts {
  treeContext: TreeContext;
  canvasRef: HTMLCanvasElement;
}

export class TreeCanvas {
  treeContext: TreeContext;
  canvasEl?: HTMLCanvasElement;
  ctx2D?: CanvasRenderingContext2D;
  scale = window.devicePixelRatio || 1;
  constructor(opts: TreeCanvasOpts) {
    this.treeContext = opts.treeContext;
    this.canvasEl = opts.canvasRef;
    const ctx2D = this.canvasEl.getContext("2d");
    if (ctx2D) {
      this.ctx2D = ctx2D;
    } else {
      throw new Error("Failed to retrieve canvasEl context");
    }
    this.canvasEl.width = this.canvasEl.offsetWidth * this.scale;
    this.canvasEl.height = this.canvasEl.offsetHeight * this.scale;
    this.ctx2D.scale(this.scale, this.scale);
    this.initRenderLoop();
  }
  get dimensions() {
    // TODO: Cache
    return [
      this.canvasEl.width / this.scale,
      this.canvasEl.height / this.scale,
    ];
  }
  initRenderLoop() {
    this.bg();
    this.fps();
    this.rows();
  }
  bg() {
    this.ctx2D.fillStyle = "#f0f0f0";
    this.ctx2D.fillRect(0, 0, this.dimensions[0], this.dimensions[1]);
    this.ctx2D.fillStyle = "black";
  }
  fps() {
    this.ctx2D.font = "12px Alte Haas Grotesk";
    this.ctx2D.textAlign = "right";
    this.ctx2D.fillText(
      "FPS: 60",
      this.dimensions[0] - 2,
      this.dimensions[1] - 4,
    );
  }
  rows() {
    let i = 0;
    // dummyList.forEach((item) => {
    //   this.row(i, item);
    //   i++;
    // });
  }
  row(index: number, item: any) {
    const itemHeight = 32;
    this.ctx2D.fillStyle = "yellow";
    this.ctx2D.fillRect(
      1,
      index * itemHeight + 1,
      this.dimensions[0] - 2,
      itemHeight,
    );
    this.ctx2D.textAlign = "left";
    this.ctx2D.fillStyle = "black";
    this.ctx2D.fillText(item.id, 0, index * itemHeight + 28);
  }
}
