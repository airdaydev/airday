import { Quadtree, Rectangle } from "@timohausmann/quadtree-ts";
import { CalRenderer } from "./render";

type UIClusterType = 0;
type UIElTypes = UIClusterType;

export type EventUIData = {
  id: string;
  type: UIElTypes;
  z: number;
};

export function hitTest(
  rect: { x: number; y: number; width: number; height: number },
  point: [number, number],
): boolean {
  return (
    point[0] >= rect.x &&
    point[0] <= rect.x + rect.width &&
    point[1] >= rect.y &&
    point[1] <= rect.y + rect.height
  );
}

/* Manages interaction */
export class CalUIObjects {
  renderer: CalRenderer;
  quads = new Map<number, Quadtree<Rectangle<EventUIData>>>();
  hits: Rectangle<EventUIData>[] = [];
  hit?: EventUIData | undefined;
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
        new Rectangle({
          x: coords[0],
          y: coords[1],
          width: this.renderer.dayPx * 2, // TODO: investigate quadtree results - dayPx should cover with, but doesn't
          height: 1,
        }),
      );
      const hit = this.hits
        .sort((a, b) => b.data.z - a.data.z)
        .find((hit) => hitTest(hit, [coords[0], coords[1]]));
      if (!hit) {
        this.hit = undefined;
      } else {
        if (!this.hit || this.hit.id !== hit.data?.id) {
          const day = this.renderer.eventCache.layoutMap.get(utcDay);
          if (!day) return console.warn("no day found in hit test");
          const event = day.map.get(hit.data.id);
          if (!event) return console.warn("no event found");
          this.renderer.eventCache.renderClusterLocal(utcDay, event.cluster);
          // this.hit = hit.data;
        }
      }
    }
  }
  clear() {
    this.quads.clear();
  }
  clearDay(utcDay: number) {
    this.quads.delete(utcDay);
  }
}
