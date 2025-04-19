import { AirdayCal } from "./cal";
import { getStartOfWeekUTC, getDateArray, DayRange, utcMidnight } from "./time";

const startOfWeekUTC = getStartOfWeekUTC(new Date());

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
  scrollChildWidth = 0;
  // Cached items that depend on offset/dayPx
  startPx: number = 0; // startPx of currently visible date range
  range: DayRange = new DayRange(new Date(startOfWeekUTC), 10).buffer(2); // range in view
  dates: Date[] = []; // TODO: Should be more of a cache based on range!
  firstHour: number = 0;
  firstHourPx: number = 0;
  clipspace: [number, number] | null = null;
  constructor(airdayCal: AirdayCal) {
    this.airdayCal = airdayCal;
  }

  // Origin date is the date at x=0, equal to utc midnight minus the days that fit between it & 0
  calcOriginDate() {
    return (
      utcMidnight(new Date()) -
      Math.floor((0.5 * this.scrollChildWidth) / this.dayPx) * 864e5
    );
  }
  get hourViewBuffer() {
    // Hours visible outside view in each direction (-/+)
    return this.hourPx * 2;
  }
  // TODO: Remove
  calcVisibleHours() {
    const minYClip = this.offset[1] - this.hourViewBuffer;
    const r = minYClip % this.hourPx;
    const firstHourPx = this.hourPx - r; // The first hour position within clip space
    const firstHour = (minYClip + firstHourPx) / this.hourPx;
    this.firstHour = firstHour;
    this.firstHourPx = firstHourPx - this.hourViewBuffer;
    return [firstHour, firstHourPx - this.hourViewBuffer];
  }
  // TODO: Remove
  hoursVisible(viewportHeight: number) {
    return Math.floor((viewportHeight + this.hourViewBuffer * 2) / this.hourPx);
  }

  // called on resize
  refitCal(viewWidth: number) {
    const nearestDay = Math.round(this.offset[0] / this.dayPx); // prior to changing this.dayPx
    this.dayPx = viewWidth / this.daysVisible;
    this.scrollChildWidth = this.dayPx * 365 * 10;
    return nearestDay * this.dayPx;
  }

  // called each frame
  updateClipspace() {
    const start = this.offset[0] - (this.offset[0] % this.dayPx); // nearest start
    const startDayInt = start / this.dayPx - 5;
    this.clipspace = [start, startDayInt];
    const startDayVal = this.originDate + startDayInt * 864e5;
    this.dates = getDateArray(startDayVal, this.daysVisible + 10);
    this.range = new DayRange(this.dates[0], this.daysVisible + 10);
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
    const delta = (normalisedDate.valueOf() - this.originDate) / 864e5;
    return delta * this.dayPx;
  }
}
