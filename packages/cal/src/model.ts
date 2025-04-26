export interface CalendarEventConstructorProps {
  id?: string;
  title?: string;
  start?: Date;
  end?: Date;
  allDay: boolean;
  color: string;
}

export interface EventSignalProps {
  id: string;
  title: string;
  start: Date;
  end: Date;
}

let idx = 0; // TODO: better id func

export class CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color: string;
  constructor(props: CalendarEventConstructorProps) {
    this.id = props.id || (idx++).toString(); // TODO: better id func
    this.title = props.title || "";
    this.start = props.start || new Date();
    this.color = props.color;
    this.end =
      props.end ||
      new Date(new Date().setMinutes(new Date().getMinutes() + 15));
  }
  serialise(): any | undefined {
    return undefined;
  }
  toJSON() {
    return {
      ...(this.serialise && this.serialise()),
      id: this.id,
      title: this.title,
      start: this.start,
      end: this.end,
      color: this.color,
    };
  }
  transfer() {
    return {
      id: this.id,
      title: this.title,
      start: this.start.valueOf(),
      end: this.end.valueOf(),
      color: this.color,
    };
  }
}
