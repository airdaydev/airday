import { createSignal, onMount } from "solid-js";
import styles from "./view.module.css";

interface PaneDropDOMRect extends DOMRect {
  limitWidth: number;
  limitHeight: number;
}

export const PaneDropGuide = () => {
  const dynamicStyle = createSignal<string>("");
  const limitFactor = 0.15;
  let rect: PaneDropDOMRect;
  let div: HTMLElement | undefined;
  onMount(() => {
    if (!div) return;
    const boundingRect = div.getBoundingClientRect();
    const limitWidth = boundingRect.width * limitFactor;
    const limitHeight = boundingRect.height * limitFactor;
    rect = Object.assign(boundingRect, {
      limitWidth,
      limitHeight,
    });
  });
  return (
    <div
      ref={div}
      onMouseMove={(event: MouseEvent) => {
        if (!rect) return;
        if (event.clientX < rect.x + rect.limitWidth) {
          return dynamicStyle[1](
            `position: absolute; top: 0; left: 0; width: ${rect.width / 2}px; height: 100%;`,
          );
        }
        if (event.clientX > rect.x + rect.width - rect.limitWidth) {
          return dynamicStyle[1](
            `position: absolute; top: 0; right: 0; width: ${rect.width / 2}px; height: 100%;`,
          );
        }
        if (event.clientY < rect.y + rect.limitHeight) {
          return dynamicStyle[1](
            `position: absolute; top: 0; left: 0; width: 100%; height: ${rect.height / 2}px;`,
          );
        }
        if (event.clientY > rect.y + rect.height - rect.limitHeight) {
          return dynamicStyle[1](
            `position: absolute; bottom: 0; left: 0; width: 100%; height: ${rect.height / 2}px;`,
          );
        }
        return dynamicStyle[1](
          `position: absolute; top: 0; right: 0; width: 100%; height: 100%;`,
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
