import { Accessor, createEffect, onCleanup, onMount, Signal } from "solid-js";
import { AirdayCal } from "./cal";
import { CalendarEvent } from "./model";
import { EventDB } from "./state";
import { Theme } from "./colours";

interface CalendarProps {
  events: Signal<CalendarEvent[]>;
  theme: Accessor<Theme>;
  parentElement: HTMLElement;
  db?: EventDB;
  cal?: AirdayCal;
  stats?: Stats;
}

export function CalSolidWrapper(props: CalendarProps) {
  let domContainer: HTMLDivElement | undefined;
  let cal: AirdayCal;
  if (props.cal && props.db) {
    console.warn("CalSolidWrapper ignoring props.db as cal is provided");
  }
  if (!props.cal) {
    if (!props.db) throw new Error("DB must be provided if cal not provided");
    cal = new AirdayCal(props.db);
  } else {
    cal = props.cal;
  }
  onMount(() => {
    if (domContainer) {
      if (props.stats) {
        cal.enableStats(props.stats);
      }
      cal.mount(domContainer);
    }
  });
  createEffect(() => {
    cal.changeTheme(props.theme());
  });
  onCleanup(() => {
    if (cal) {
      cal.cleanUp();
    }
  });
  return <div ref={domContainer} />;
}
