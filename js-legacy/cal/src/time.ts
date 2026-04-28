export const oneDayMs = 864e5;

export const getStartOfWeekUTC = (date: Date) => {
  const dayOfWeek = date.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayDate = new Date(date);
  mondayDate.setDate(date.getDate() - daysSinceMonday);
  return utcMidnight(mondayDate);
};

// Warning: this is the UTC date midnight (i.e. the 0th millisecond of the day, of the UTC moment of the day)
export function utcMidnight(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function utcZeroDate(date: Date) {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
}

export function isTodayUTC(utcDate: Date) {
  const today = new Date();
  const date = today.getDate();
  const month = today.getMonth();
  const year = today.getFullYear();
  return (
    utcDate.getUTCDate() === date &&
    utcDate.getUTCMonth() === month &&
    utcDate.getUTCFullYear() === year
  );
}

export function validateUTCMidnight(date: Date) {
  const hours = date.getHours();
  if (date.valueOf() % (24 * 60 * 60 * 1000) !== 0) {
    throw new Error("localZeroDate expects 0:00:00 timestamp");
  }
  const tzOffset = date.getTimezoneOffset();
  if (hours !== Math.abs(tzOffset / 60)) {
    throw new Error("localZeroDate did not received UTC 0hrs");
  }
  return true;
}

// Returns same date as provided UTC/GMT time, but moves to 00:00 in local time
// This is useful for translating to calendar space to user local time
export function localZeroDate(date: Date) {
  validateUTCMidnight(date); // throw if not valid UTC midnight timestamp
  const newDate = new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  return newDate;
}

export const getDateUTC = (date: Date, month = false) => {
  const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const day = days[date.getUTCDay()];
  const dateMonth = date.getUTCDate();
  const str = `${day} ${dateMonth.toString().padStart(2, "0")}`;
  if (month) {
    const mo = date.getUTCMonth();
    return `${str}/${(mo + 1).toString().padStart(2, "0")}`;
  }
  return str;
};

export const getDate = (date: Date) => {
  const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const day = days[date.getDay()];
  const dateMonth = date.getDate();
  const mo = date.getMonth();
  return `${day} ${dateMonth.toString().padStart(2, "0")}/${(mo + 1).toString().padStart(2, "0")}`;
};

const relativeDay = (dateVal: number, relativeDays: number) => {
  return new Date(dateVal + relativeDays * oneDayMs);
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
    return new Date(this.start.valueOf() + oneDayMs * this.days);
  }
  buffer(days: number = 3) {
    this.start = new Date(this.start.valueOf() - oneDayMs * days);
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

export function getTime(dateNum: number) {
  const date = new Date(dateNum);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

export function ddmm(dateNum: number) {
  const date = new Date(dateNum);
  return `${date.getDate().toString().padStart(2, "0")}/${date.getMonth().toString().padStart(2, "0")}`;
}

export function timeToY(date: Date, hourPx: number) {
  const hours = date.getHours() * hourPx;
  const min = (date.getMinutes() * hourPx) / 60;
  return hours + min;
}
