import { CalRenderer } from "./render";

export class CalendarTransform {
  offset = [0, 0]; // Scroll offset
  hourPx = 30; // 1 hour = 50px
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
    const minXClip = this.offset[0] - this.renderer.dayWidth; // 1 day buffer behind offset in screen space
    const r = minXClip % this.renderer.dayWidth;
    const firstDayPx = minXClip - r - this.offset[0]; // The first day position within clip space
    const relStartDay = Math.round(
      (firstDayPx + this.offset[0]) / this.renderer.dayWidth,
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
    if (y !== 0) {
      this.renderer.scrollable.scrollTo(0, this.offset[1]);
    }
  }
  xStart(x: number) {
    const r = (x % this.renderer.gridOffset[0]) + this.offset[0];
    return x - r;
  }
  yToTime(y: number) {
    return (y - this.offset[1] - this.renderer.gridOffset[1]) / this.hourPx - 1;
  }
  xToDay(x: number) {
    return Math.floor(
      (x - this.renderer.gridOffset[0] + this.offset[0]) /
        this.renderer.dayWidth,
    );
  }
  dateToX(date: Date) {
    const normalisedDate = new Date(date);
    normalisedDate.setHours(0);
    normalisedDate.setMinutes(0);
    normalisedDate.setSeconds(0);
    return (
      ((normalisedDate.valueOf() - this.renderer.originDate.valueOf()) /
        864e5) *
        this.renderer.dayWidth -
      this.offset[0] +
      this.renderer.gridOffset[0]
    );
  }
}
