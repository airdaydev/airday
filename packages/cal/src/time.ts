export const getStartOfWeekUTC = (date: Date) => {
  const dayOfWeek = date.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayDate = new Date(date);
  mondayDate.setDate(date.getDate() - daysSinceMonday);
  return utcMidnight(mondayDate);
};

export function utcMidnight(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Returns same date as provided UTC/GMT time, but moves to 00:00 in local time
export function localZeroDate(date: Date) {
  const hours = date.getHours();
  if (date.getMinutes() || date.getSeconds() || date.getMilliseconds()) {
    throw new Error("localZeroDate expects 0:00:00 timestamp");
  }
  const tzOffset = date.getTimezoneOffset();
  if (hours !== Math.abs(tzOffset / 60)) {
    throw new Error("localZeroDate did not received UTC 0hrs");
  }
  const newDate = new Date();
  newDate.setMilliseconds(0);
  newDate.setSeconds(0);
  newDate.setMinutes(0);
  newDate.setHours(0);
  newDate.setDate(date.getUTCDate());
  newDate.setMonth(date.getUTCMonth());
  newDate.setFullYear(date.getUTCFullYear());
  return newDate;
}

export const getDate = (date: Date) => {
  const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const day = days[date.getDay()];
  const dateMonth = date.getDate();
  const mo = date.getMonth();
  return `${day} ${dateMonth.toString().padStart(2, "0")}/${(mo + 1).toString().padStart(2, "0")}`;
};

const relativeDay = (dateVal: number, relativeDays: number) => {
  return new Date(dateVal + relativeDays * 864e5);
};

export const getDateArray = (startDate: number, dayCount: number): Date[] => {
  let arr: Date[] = [];
  for (let i = 0; i < dayCount; i++) {
    arr.push(relativeDay(startDate, i));
  }
  return arr;
};

export function isWeekend(date: Date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

export class DayRange {
  start: Date;
  days: number;
  constructor(start: Date, days: number) {
    this.start = start;
    this.days = days;
  }
  get end() {
    return new Date(this.start.valueOf() + 864e5 * this.days);
  }
  buffer(days: number = 3) {
    this.start = new Date(this.start.valueOf() - 864e5 * days);
    this.days = this.days + days;
    return this;
  }
  get localStart() {
    return localZeroDate(this.start);
  }
  get localEnd() {
    return localZeroDate(this.end);
  }
}

export function localMidnight(date: Date) {
  const newDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  newDate.setMilliseconds(0);
  newDate.setMinutes(0);
  newDate.setHours(0);
  return newDate.valueOf();
}

export function addDays(date: Date, i: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + i);
  return next;
}

export function addDaysNumber(number: number, i: number) {
  return addDays(new Date(number), i).valueOf();
}
