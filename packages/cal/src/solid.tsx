import { Accessor, createEffect, onCleanup, onMount, Signal } from "solid-js";
import { CalRenderer } from "./render";
import { CalendarEvent } from "./event";
import { EventDB } from "./state";

interface CalendarProps {
  events: Signal<CalendarEvent[]>;
  theme: Accessor<"dark" | "light">;
  parentElement: HTMLElement;
  db?: EventDB;
}

export function CalSolidWrapper(props: CalendarProps) {
  let domContainer: HTMLDivElement | undefined;
  let cal: CalRenderer;
  onMount(() => {
    if (domContainer) {
      cal = new CalRenderer(domContainer, props.db);
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
