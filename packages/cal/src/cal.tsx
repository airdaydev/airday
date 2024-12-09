import styles from "./cal.module.css";
import { onCleanup, onMount } from "solid-js";
import { Cal } from "./render";

export default function App() {
  let html: HTMLDivElement | undefined;
  let container: HTMLDivElement | undefined;
  let headerCanvas: HTMLCanvasElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let cal: Cal;
  onMount(() => {
    if (container && headerCanvas && canvas)
      cal = new Cal({
        container,
        headerCanvas,
        canvas,
      });
  });
  onCleanup(() => {
    if (cal) cal.cleanUp();
  });
  return (
    <>
      <h1>@sunlist/cal</h1>
      <div class={styles["cal-container"]}>
        <canvas ref={headerCanvas} class={styles["header-canvas"]} />
        <div class={styles["grid-container"]} ref={container}>
          <div class={styles["events"]} ref={html}></div>
          <canvas class={styles["grid-canvas"]} ref={canvas} />
        </div>
      </div>
    </>
  );
}
