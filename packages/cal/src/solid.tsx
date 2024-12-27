import styles from "./cal.module.css";
import { onCleanup, onMount, Signal } from "solid-js";
import { CalRenderer } from "./render";
import { CalendarEvent } from "./event";

interface CalendarProps {
  events: Signal<CalendarEvent[]>;
  parentElement: HTMLElement;
}

export function CalSolidWrapper(props: CalendarProps) {
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
  return <div ref={domContainer} class={styles["cal-container"]} />;
}
