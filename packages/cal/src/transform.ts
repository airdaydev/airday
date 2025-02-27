import { CalRenderer } from "./render";
import { getStartOfWeekUTC, getDateArray, DayRange } from "./time";

const startOfWeekUTC = getStartOfWeekUTC(new Date());

export class Clipspace {
  originDate = startOfWeekUTC;
  startPx: number = 0;
  dates: Date[] = [];
  calRenderer: CalRenderer;
  range: DayRange = new DayRange(new Date(startOfWeekUTC), 10).buffer(2); // range in view
  constructor(calRenderer: CalRenderer) {
    this.calRenderer = calRenderer;
  }
  get size() {
    return this.dates.length;
  }
  update(startPx: number, relStartDay: number) {
    this.startPx = startPx;
    const clipStartDayAbs = new Date(
      this.originDate.valueOf() + relStartDay * 864e5,
    );
    this.dates = getDateArray(
      clipStartDayAbs.valueOf(),
      this.calRenderer.clipDays + 5,
    );
    this.range = new DayRange(this.dates[0], this.calRenderer.clipDays + 5);
  }
}

export class CalendarTransform {
  offset = [0, 0]; // Scroll offset
  // TODO: Move dayPx here
  hourPx = 50; // 1 hour = 50px
  renderer: CalRenderer;
  constructor(renderer: CalRenderer) {
    this.renderer = renderer;
  }
  get hourViewBuffer() {
    // Hours visible outside view in each direction (-/+)
    return this.hourPx * 2;
  }
  getVisibleHours() {
    const minYClip = this.offset[1] - this.hourViewBuffer;
    const r = minYClip % this.hourPx;
    const firstHourPx = this.hourPx - r; // The first hour position within clip space
    const firstHour = (minYClip + firstHourPx) / this.hourPx;
    return [firstHour, firstHourPx - this.hourViewBuffer];
  }
  hoursVisible(viewportHeight: number) {
    return Math.floor((viewportHeight + this.hourViewBuffer * 2) / this.hourPx);
  }
  clipspaceOriginX() {
    const minXClip = this.offset[0] - this.renderer.dayPx; // 1 day buffer behind offset in screen space
    const r = minXClip % this.renderer.dayPx;
    const firstDayPx = minXClip - r - this.offset[0]; // The first day position within clip space
    const relStartDay = Math.round(
      (firstDayPx + this.offset[0]) / this.renderer.dayPx,
    );
    return [firstDayPx + this.renderer.gridOffset[0], relStartDay];
  }
  timeToY(date: Date) {
    const hours = date.getHours() * this.hourPx;
    const min = (date.getMinutes() * this.hourPx) / 60;
    return hours + min - this.offset[1] + this.renderer.gridOffset[1];
  }
  maxYOffset() {
    return Math.max(
      0,
      this.renderer.scrollHeight - this.renderer.canvas.clientHeight,
    );
  }
  addDelta(x: number, y: number) {
    this.offset[0] = this.offset[0] + x;
    this.offset[1] = Math.min(
      Math.max(this.offset[1] + y, 0),
      this.maxYOffset(),
    );
    // TODO: allow overscroll but automatically swing back
    // this.offset[1] = this.offset[1] + y;
    if (y !== 0) {
      this.renderer.scrollable.scrollTo(0, this.offset[1]);
    }
  }
  xStart(x: number) {
    const r = (x % this.renderer.gridOffset[0]) + this.offset[0];
    return x - r;
  }
  yToTime(y: number) {
    return (y + this.offset[1] - this.renderer.gridOffset[1]) / this.hourPx;
  }
  xToDay(x: number) {
    return Math.floor(
      (x - this.renderer.gridOffset[0] + this.offset[0]) / this.renderer.dayPx,
    );
  }
  dateToX(date: Date) {
    const normalisedDate = new Date(date);
    normalisedDate.setHours(0);
    normalisedDate.setMinutes(0);
    normalisedDate.setSeconds(0);
    return (
      ((normalisedDate.valueOf() -
        this.renderer.clipspace.originDate.valueOf()) /
        864e5) *
        this.renderer.dayPx -
      this.offset[0] +
      this.renderer.gridOffset[0]
    );
  }
}
