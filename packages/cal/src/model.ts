import { Signal, createSignal, createUniqueId } from "solid-js";

export interface CalendarEventConstructorProps {
  id?: string;
  title?: string;
  start?: Date;
  end?: Date;
  allDay: boolean;
}

export interface EventSignalProps {
  id: string;
  title: string;
  start: Date;
  end: Date;
}

export class CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  signal: Signal<EventSignalProps & ReturnType<this["serialise"]>>;
  constructor(props: CalendarEventConstructorProps) {
    this.id = props.id || createUniqueId();
    this.title = props.title || "";
    this.start = props.start || new Date();
    this.end =
      props.end ||
      new Date(new Date().setMinutes(new Date().getMinutes() + 15));
    this.signal = createSignal(this.toJSON());
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
    };
  }
  transfer() {
    return {
      id: this.id,
      title: this.title,
      start: this.start.valueOf(),
      end: this.end.valueOf(),
    };
  }
}
