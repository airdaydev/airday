export const getStartOfWeek = (date: Date) => {
  const dayOfWeek = date.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const mondayDate = new Date(date);
  mondayDate.setHours(0);
  mondayDate.setMinutes(0);
  mondayDate.setSeconds(0);
  mondayDate.setMilliseconds(0);
  mondayDate.setDate(date.getDate() - daysSinceMonday);
  return mondayDate;
};

export const getStartOfDay = (date: Date) => {
  const start = new Date(date);
  start.setHours(0);
  start.setMinutes(0);
  start.setSeconds(0);
  return start;
};

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
}
