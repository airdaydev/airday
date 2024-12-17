import styles from "./cal.module.css";
import { onCleanup, onMount } from "solid-js";
import { CalRenderer } from "./render";

export function Cal() {
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
  });
  onCleanup(() => {
    if (cal) {
      cal.cleanUp();
    }
  });
  return (
    <div class={styles["cal-container"]}>
      <canvas ref={headerCanvas} class={styles["header-canvas"]} />
      <div class={styles["grid-container"]} ref={container}>
        <div class="grid-scroll">
          <div class={styles["events"]} ref={domContainer} />
        </div>
        <canvas class={styles["grid-canvas"]} ref={canvas} />
      </div>
    </div>
  );
}
