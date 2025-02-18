import { Quadtree, Rectangle } from "@timohausmann/quadtree-ts";
import { CalRenderer } from "./render";

type UIClusterType = 0;
type UIElTypes = UIClusterType;

export type EventUIData = {
  id: string;
  type: UIElTypes;
};

/* Manages interaction */
export class CalUIObjects {
  renderer: CalRenderer;
  quads = new Map<number, Quadtree<Rectangle<EventUIData>>>();
  hits: Rectangle<EventUIData>[] = [];
  constructor(renderer: CalRenderer) {
    this.renderer = renderer;
  }
  updateDay(utcDay: number, objects: Rectangle<EventUIData>[]) {
    const tree = new Quadtree<Rectangle<EventUIData>>({
      width: this.renderer.dayPx, // get dayPx
      height: this.renderer.transform.hourPx * 25, // get FullHeight
    });
    objects.map((event) => tree.insert(event));
    this.quads.set(utcDay, tree);
  }
  testCollision(utcDay: number, coords: [number, number]) {
    const quad = this.quads.get(utcDay);
    if (quad) {
      this.hits = quad.retrieve(
        new Rectangle({ x: coords[0], y: coords[1], width: 1, height: 1 }),
      );
    }
  }
  clear() {
    this.quads.clear();
  }
  clearDay(utcDay: number) {
    this.quads.delete(utcDay);
  }
}
