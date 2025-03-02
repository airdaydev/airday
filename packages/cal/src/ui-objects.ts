import { Quadtree, Rectangle } from "@timohausmann/quadtree-ts";
import { AirdayCal } from "./cal";
import { localZeroDate } from "./time";
import { Rect } from "./canvas";

type UIClusterType = 0;
type UIElTypes = UIClusterType;

export type EventUIData = {
  id: string;
  type: UIElTypes;
  z: number;
};

export function hitTest(rect: Rect, point: [number, number]): boolean {
  return (
    point[0] >= rect.x &&
    point[0] <= rect.x + rect.width &&
    point[1] >= rect.y &&
    point[1] <= rect.y + rect.height
  );
}

export function rectIntersection(rect1: Rect, rect2: Rect): boolean {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
}

function normaliseRect(rect: Rect): Rect {
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    x: Math.round(rect.x),
    y: Math.round(rect.y),
  };
}

interface Hover {
  rendered: boolean;
  region: Rect;
  date: number;
  id: string;
  ts: number; // timestamp it first appeared
}

/* Manages interaction */
export class CalUIObjects {
  airdayCal: AirdayCal;
  quads = new Map<number, Quadtree<Rectangle<EventUIData>>>();
  hits: Rectangle<EventUIData>[] = [];
  hit?: EventUIData | undefined;
  hover: Hover | null = null;
  selected = new Map<string, Hover>();
  constructor(airdayCal: AirdayCal) {
    this.airdayCal = airdayCal;
  }
  updateDay(utcDay: number, objects: Rectangle<EventUIData>[]) {
    const tree = new Quadtree<Rectangle<EventUIData>>({
      width: this.airdayCal.transform.dayPx, // get dayPx
      height: this.airdayCal.transform.hourPx * 25, // get FullHeight
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
          width: this.airdayCal.transform.dayPx * 2, // TODO: investigate quadtree results - dayPx should cover with, but doesn't
          height: 1,
        }),
      );
      const hit = this.hits
        .sort((a, b) => b.data.z - a.data.z)
        .find((hit) => hitTest(hit, [coords[0], coords[1]]));
      if (!hit) {
        this.hit = undefined;
        this.hover = null;
      } else {
        // Skip if hit is same
        if (!this.hit || this.hit.id !== hit.data?.id) {
          if (!hit.data) {
            console.warn("No hit data found", hit);
            return;
          }
          const day = this.airdayCal.coordinator.layoutCache.get(utcDay);
          if (!day) return console.warn("no day found in hit test");
          const event = day.data.map.get(hit.data.id);
          if (!event) return console.warn("no event found");
          const localDate = localZeroDate(new Date(utcDay)).valueOf();
          this.hover = {
            rendered: false,
            date: localDate,
            region: normaliseRect(hit),
            id: hit.data.id,
            ts: performance.now(),
          };
          this.selected.set(hit.data.id, this.hover);
          this.hit = hit.data;
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
