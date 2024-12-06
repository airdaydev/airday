import styles from "./cal.module.css";
import { onCleanup, onMount } from "solid-js";
import { Cal } from "./render";

export default function App() {
  let containerEl: HTMLDivElement | undefined;
  let html: HTMLDivElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let cal = new Cal();
  onMount(() => {
    if (canvas) cal.mount(canvas);
  });
  onCleanup(() => {
    cal.cleanUp();
  });
  return (
    <>
      <h1>@sunlist/cal</h1>
      <div class={styles["cal-container"]} ref={containerEl}>
        <div ref={html}></div>
        <canvas ref={canvas} />
      </div>
    </>
  );
}
