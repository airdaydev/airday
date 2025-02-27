import { Accessor, createEffect, onCleanup, onMount, Signal } from "solid-js";
import { AirdayCal } from "./cal";
import { CalendarEvent } from "./model";
import { EventDB } from "./state";
import { Theme } from "./colours";

interface CalendarProps {
  events: Signal<CalendarEvent[]>;
  theme: Accessor<Theme>;
  parentElement: HTMLElement;
  db: EventDB;
}

export function CalSolidWrapper(props: CalendarProps) {
  let domContainer: HTMLDivElement | undefined;
  let cal: AirdayCal;
  onMount(() => {
    if (domContainer) {
      cal = new AirdayCal(domContainer, props.db);
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
  return (
    <div
      ref={domContainer}
      style={`position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  box-sizing: border-box;`}
    />
  );
}
