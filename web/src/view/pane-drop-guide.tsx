import { createEffect, createSignal, onMount } from "solid-js";
import styles from "./view.module.css";
import { defaultMapping } from "@borde/list/src/keyboard/mapping";
import { DataView, viewState } from "./state";
import { ListDragContext, Node } from "@borde/list";

interface PaneDropDOMRect extends DOMRect {
  limitWidth: number;
  limitHeight: number;
}

type DropRegion = "all" | "left" | "right" | "top" | "bottom" | "none";

interface PaneDropGuideProps {
  view: DataView;
  container: ListDragContext;
}

export const PaneDropGuide = (props: PaneDropGuideProps) => {
  const dropRegion = createSignal<DropRegion>("all");
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
  const style = (dropRegion: DropRegion) => {
    if (!rect) return;
    switch (dropRegion) {
      case "left":
        return `position: absolute; top: 0; left: 0; width: ${rect.width / 2}px; height: 100%;`;
      case "right":
        return `position: absolute; top: 0; right: 0; width: ${rect.width / 2}px; height: 100%;`;
      case "top":
        return `position: absolute; top: 0; left: 0; width: 100%; height: ${rect.height / 2}px;`;
      case "bottom":
        return `position: absolute; bottom: 0; left: 0; width: 100%; height: ${rect.height / 2}px;`;
      case "all":
        return `position: absolute; top: 0; right: 0; width: 100%; height: 100%;`;
      default:
        return "";
    }
  };
  return (
    <div
      ref={div}
      onMouseMove={(event: MouseEvent) => {
        if (!rect) return;
        if (event.clientX < rect.x + rect.limitWidth) {
          return dropRegion[1]("left");
        }
        if (event.clientX > rect.x + rect.width - rect.limitWidth) {
          return dropRegion[1]("right");
        }
        if (event.clientY < rect.y + rect.limitHeight) {
          return dropRegion[1]("top");
        }
        if (event.clientY > rect.y + rect.height - rect.limitHeight) {
          return dropRegion[1]("bottom");
        }
        return dropRegion[1]("all");
      }}
      onMouseLeave={() => {
        return dropRegion[1]("none");
      }}
      onMouseUp={() => {
        const region = dropRegion[0]();
        if (region === "left") {
          const dataView = new DataView(props.container.id);
          props.view.addLeft(dataView);
        }
        if (region === "right") {
          const dataView = new DataView(props.container.id);
          props.view.addRight(dataView);
        }
        if (region === "top") {
          const dataView = new DataView(props.container.id);
          props.view.addUp(dataView);
        }
        if (region === "bottom") {
          const dataView = new DataView(props.container.id);
          props.view.addDown(dataView);
        }
        if (region === "all") {
          const dataView = new DataView(props.container.id);
          viewState.addViewToRoot(dataView);
        }
      }}
      class={styles["pane-drop-guide-container"]}
    >
      <div
        class={styles["pane-drop-guide"]}
        style={style(dropRegion[0]())}
      ></div>
    </div>
  );
};
