import { AirdayCal } from "../cal";
import { CalendarEvent } from "../model";
import { EventDB } from "../state";
import { Rect } from "../canvas";
import { DayRange, utcZeroDate } from "../time";
import { DayLayout } from "./layout";
import { Rectangle } from "@timohausmann/quadtree-ts";
import { EventUIData } from "../ui-objects";
import { renderDay } from "./render";

// Legacy, remove after migration to coordinator
export class EventCache {
  airdayCal: AirdayCal;
  db: EventDB;
  bitmapMap = new Map<number, ImageBitmap>();
  layoutMap = new Map<number, DayLayout>();
  map = new Map<number, Set<CalendarEvent>>();
  transformMap = new Map<string, { x: number; y: number }>();
  range: DayRange | null = null;
  arr: CalendarEvent[] = []; // temp array of all events
  constructor(airdayCal: AirdayCal, db: EventDB) {
    this.airdayCal = airdayCal;
    this.db = db;
  }
  // outgoing region
  async renderRegion(
    date: number,
    region: Rect,
    offset?: [number, number],
    highlightId?: string,
    ts?: number,
  ) {
    const zeroDate = utcZeroDate(new Date(date)).valueOf();
    const layout = this.layoutMap.get(zeroDate);
    if (!layout) {
      console.warn(`Cant rerender layout region ${date}`);
      return;
    }
    // TODO: Set canvas x/y
    renderDay(this.airdayCal.ctx2D, layout, date, {
      theme: this.airdayCal.theme,
      region,
      shadows: true,
      offset,
      highlightId,
      fadeTs: ts,
    });
  }
  // incoming
  reflow(date: number, layout: DayLayout) {
    this.layoutMap.set(date, layout);
    const objs: Rectangle<EventUIData>[] = [];
    for (let [id, event] of layout.map.entries()) {
      objs.push(
        new Rectangle<EventUIData>({
          x: event.x,
          width: event.width,
          y: event.y,
          height: event.height,
          data: {
            type: 0,
            id,
            z: event.segment,
          },
        }),
      );
    }
    this.airdayCal.uiObjects.updateDay(date, objs);
  }
}
