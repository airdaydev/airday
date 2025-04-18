import { AirdayCal } from "./cal";
import { getStartOfWeekUTC, getDateArray, DayRange } from "./time";

const startOfWeekUTC = getStartOfWeekUTC(new Date());

// const defaultScrollChildWidth = 1000000; // 1mil = @ 300px per day approx 10 years (we could recalc to fit days in exactly)
const defaultScrollChildWidth = 50000; // 1mil = @ 300px per day approx 10 years (we could recalc to fit days in exactly)

// Clipspace and day/time to x/y transform concerns
export class CalendarTransform {
  airdayCal: AirdayCal;
  // Start dimensions
  hourPx = 50; // 1 hour grid height
  dayPx = 100; // 1 day grid width
  headerHeight = 50; // aka header height
  allDayRowHeight = 50;
  margin = 10;
  // End dimensions
  offset = [0, 0]; // Scroll offset
  daysVisible = 14; // qty. days to fit into view space
  originDate: number = 0; // day at x = 0
  scrollChildWidth = defaultScrollChildWidth;
  // Cached items that depend on offset/dayPx
  startPx: number = 0; // startPx of currently visible date range
  range: DayRange = new DayRange(new Date(startOfWeekUTC), 10).buffer(2); // range in view
  dates: Date[] = []; // TODO: Should be more of a cache based on range!
  firstHour: number = 0;
  firstHourPx: number = 0;
  clipspace: [number, number] | null = null;
  constructor(airdayCal: AirdayCal) {
    this.airdayCal = airdayCal;
    this.originDate = this.calcOriginDate();
  }
  // Origin date at x = 0 of container
  // In a canvas implementation origin date = now, but I'm doing DOM-based instead of date-biased
  // Target date is that which is targeted to be in approximately the center of the scrollable component
  calcOriginDate() {
    return (
      startOfWeekUTC -
      Math.floor((0.5 * this.scrollChildWidth) / this.dayPx) * 864e5
    );
  }
  get scrollStart() {
    return this.startPx + this.offset[0] - this.gridOffset[0];
  }
  fitCalWidth(canvasWidth: number) {
    const approxDay = this.offset[0] / this.dayPx; // Get existing day
    this.dayPx = (canvasWidth - this.hourPx) / this.daysVisible;
    this.offset[0] = approxDay * this.dayPx;
  }
  get hourViewBuffer() {
    // Hours visible outside view in each direction (-/+)
    return this.hourPx * 2;
  }
  calcVisibleHours() {
    const minYClip = this.offset[1] - this.hourViewBuffer;
    const r = minYClip % this.hourPx;
    const firstHourPx = this.hourPx - r; // The first hour position within clip space
    const firstHour = (minYClip + firstHourPx) / this.hourPx;
    this.firstHour = firstHour;
    this.firstHourPx = firstHourPx - this.hourViewBuffer;
    return [firstHour, firstHourPx - this.hourViewBuffer];
  }
  hoursVisible(viewportHeight: number) {
    return Math.floor((viewportHeight + this.hourViewBuffer * 2) / this.hourPx);
  }

  updateClipspace() {
    const start = this.offset[0] - (this.offset[0] % this.dayPx); // nearest start
    const startDayInt = start / this.dayPx - 5;
    this.clipspace = [start, startDayInt];
    const startDayVal = this.originDate.valueOf() + startDayInt * 864e5;
    this.dates = getDateArray(startDayVal, this.daysVisible + 10);
    this.range = new DayRange(this.dates[0], this.daysVisible + 10);
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
    // if (y !== 0) {
    //   this.airdayCal.scrollable.scrollTo(0, this.offset[1]);
    // }
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
  // TODO: Expects UTC date (validate?)
  dateToX(date: number) {
    const normalisedDate = new Date(date);
    const delta =
      (normalisedDate.valueOf() - this.originDate.valueOf()) / 864e5;
    return delta * this.dayPx;
  }
}
