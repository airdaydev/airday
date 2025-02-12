import { Quadtree, Rectangle } from "@timohausmann/quadtree-ts";
import { CalRenderer } from "./render";

interface EventUIObject extends Rectangle {
  id: string;
}

/* Manages interaction */
export class CalUIObjects {
  renderer: CalRenderer;
  quads = new Map<number, Quadtree<EventUIObject>>();
  constructor(renderer: CalRenderer) {
    this.renderer = renderer;
  }
  updateDay(utcDay: number, events: EventUIObject[]) {
    const tree = new Quadtree<EventUIObject>({
      width: this.renderer.dayPx, // get dayPx
      height: this.renderer.transform.hourPx * 25, // get FullHeight
    });
    events.map((event) => tree.insert(event));
    this.quads.set(utcDay, tree);
  }
  testCollision(utcDay: number, coords: [number, number]) {
    console.log(utcDay, coords);
  }
  clear() {
    this.quads.clear();
  }
  clearDay(utcDay: number) {
    this.quads.delete(utcDay);
  }
}
