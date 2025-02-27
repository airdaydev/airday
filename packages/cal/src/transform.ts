import { AirdayCal } from "./cal";
import { getStartOfWeekUTC, getDateArray, DayRange } from "./time";

const startOfWeekUTC = getStartOfWeekUTC(new Date());

export class Clipspace {
  originDate = startOfWeekUTC;
  startPx: number = 0;
  dates: Date[] = [];
  AirdayCal: AirdayCal;
  range: DayRange = new DayRange(new Date(startOfWeekUTC), 10).buffer(2); // range in view
  constructor(AirdayCal: AirdayCal) {
    this.AirdayCal = AirdayCal;
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
      this.AirdayCal.clipDays + 5,
    );
    this.range = new DayRange(this.dates[0], this.AirdayCal.clipDays + 5);
  }
}

export class CalendarTransform {
  offset = [0, 0]; // Scroll offset
  hourPx = 50; // 1 hour grid height
  dayPx = 100; // 1 day grid width
  headerHeight = 50; // aka header height
  allDayRowHeight = 50;
  margin = 10;
  airdayCal: AirdayCal;
  constructor(airdayCal: AirdayCal) {
    this.airdayCal = airdayCal;
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
    const minXClip = this.offset[0] - this.dayPx; // 1 day buffer behind offset in screen space
    const r = minXClip % this.dayPx;
    const firstDayPx = minXClip - r - this.offset[0]; // The first day position within clip space
    const relStartDay = Math.round((firstDayPx + this.offset[0]) / this.dayPx);
    return [firstDayPx + this.gridOffset[0], relStartDay];
  }
  timeToY(date: Date) {
    const hours = date.getHours() * this.hourPx;
    const min = (date.getMinutes() * this.hourPx) / 60;
    return hours + min - this.offset[1] + this.gridOffset[1];
  }
  maxYOffset() {
    return Math.max(
      0,
      this.airdayCal.scrollHeight - this.airdayCal.canvas.clientHeight,
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
      this.airdayCal.scrollable.scrollTo(0, this.offset[1]);
    }
  }
  xStart(x: number) {
    const r = (x % this.gridOffset[0]) + this.offset[0];
    return x - r;
  }
  yToTime(y: number) {
    return (y + this.offset[1] - this.gridOffset[1]) / this.hourPx;
  }
  xToDay(x: number) {
    return Math.floor((x - this.gridOffset[0] + this.offset[0]) / this.dayPx);
  }
  get gridOffset() {
    return [50, this.headerHeight + this.allDayRowHeight];
  }
  dateToX(date: Date) {
    const normalisedDate = new Date(date);
    normalisedDate.setHours(0);
    normalisedDate.setMinutes(0);
    normalisedDate.setSeconds(0);
    return (
      ((normalisedDate.valueOf() -
        this.airdayCal.clipspace.originDate.valueOf()) /
        864e5) *
        this.dayPx -
      this.offset[0] +
      this.gridOffset[0]
    );
  }
}
