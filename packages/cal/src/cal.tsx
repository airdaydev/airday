import styles from "./cal.module.css";
import { For, onCleanup, onMount, Signal } from "solid-js";
import { CalRenderer } from "./render";
import { CalendarEvent } from "./event";

interface CalendarProps {
  events: Signal<CalendarEvent[]>;
}

export function Cal(props: CalendarProps) {
  let domContainer: HTMLDivElement | undefined;
  let container: HTMLDivElement | undefined;
  let headerCanvas: HTMLCanvasElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let cal: CalRenderer;
  onMount(() => {
    if (container && headerCanvas && canvas && domContainer)
      cal = new CalRenderer({
        container,
        headerCanvas,
        canvas,
        domContainer,
      });
    // TODO: Register events here
  });
  onCleanup(() => {
    if (cal) {
      cal.cleanUp();
    }
  });
  return (
    <div class={styles["cal-container"]}>
      <canvas ref={headerCanvas} class={styles["header-canvas"]} />
      <div class={styles["grid-container"]}>
        <div class={styles["grid-scroll"]} ref={container}>
          <div class={styles["events"]} ref={domContainer}>
            <For each={props.events[0]()}>
              {(item) => (
                <div
                  class={styles["event"]}
                  style={`top: ${cal?.transform.timeToY(item.start) || 0}px; left: 0`}
                >
                  Event {item.title}
                </div>
              )}
            </For>
          </div>
        </div>
        <canvas class={styles["grid-canvas"]} ref={canvas} />
      </div>
    </div>
  );
}
