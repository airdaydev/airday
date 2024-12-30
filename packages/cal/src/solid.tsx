import { onCleanup, onMount, Signal } from "solid-js";
import { CalRenderer } from "./render";
import { CalendarEvent } from "./event";

interface CalendarProps {
  events: Signal<CalendarEvent[]>;
  parentElement: HTMLElement;
}

export function CalSolidWrapper(props: CalendarProps) {
  console.log(props);
  let domContainer: HTMLDivElement | undefined;
  let cal: CalRenderer;
  onMount(() => {
    if (domContainer) {
      cal = new CalRenderer(domContainer);
    }
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
