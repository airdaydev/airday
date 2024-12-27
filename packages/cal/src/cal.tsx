import styles from "./cal.module.css";
import { createSignal, For, onCleanup, onMount, Show, Signal } from "solid-js";
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
  let mounted = createSignal<boolean>(false);
  let cal: CalRenderer;
  onMount(() => {
    if (container && headerCanvas && canvas && domContainer)
      cal = new CalRenderer({
        container,
        headerCanvas,
        canvas,
        domContainer,
      });
    mounted[1](true);
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
            <Show when={mounted[0]()}>
              <For each={props.events[0]()}>
                {(item, index) => (
                  <div
                    class={styles["event"]}
                    style={`top: ${cal!.transform.timeToY(item.start) || 0}px; left: 0`}
                  >
                    Event {item.label}
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
        <canvas class={styles["grid-canvas"]} ref={canvas} />
      </div>
    </div>
  );
}
