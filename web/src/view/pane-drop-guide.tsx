import { createSignal, onMount } from "solid-js";
import styles from "./view.module.css";

export const PaneDropGuide = () => {
  const dynamicStyle = createSignal<string>("");
  let dimensions = [0, 0];
  let div: HTMLElement | undefined;
  onMount(() => {
    if (!div) return;
    const bounds = div.getBoundingClientRect();
    dimensions = [bounds.width, bounds.height];
  });
  return (
    <div
      ref={div}
      onMouseMove={(event: MouseEvent) => {
        console.log(event.clientX, event.clientY);
        // anchor right or left?
        // anchor top or bottom?
        // anchor full?
        if (true)
          dynamicStyle[1](
            "position: absolute; top: 0; right: 0; width: 20px; height: 20px;",
          );
      }}
      onMouseLeave={() => {
        dynamicStyle[1]("");
      }}
      class={styles["pane-drop-guide-container"]}
    >
      <div class={styles["pane-drop-guide"]} style={dynamicStyle[0]()}></div>
    </div>
  );
};
