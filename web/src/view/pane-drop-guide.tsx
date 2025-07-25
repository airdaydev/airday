import { createSignal, onMount, useContext } from "solid-js";
import styles from "./view.module.css";
import { DataView } from "./state";
import { sessionContext } from "../store/context";

interface PaneDropDOMRect extends DOMRect {
  limitWidth: number;
  limitHeight: number;
}

type DropRegion = "all" | "left" | "right" | "none";

interface PaneDropGuideProps {
  view: DataView;
}

export const PaneDropGuide = (props: PaneDropGuideProps) => {
  const session = useContext(sessionContext);
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
        return dropRegion[1]("all");
      }}
      onMouseLeave={() => {
        return dropRegion[1]("none");
      }}
      onMouseUp={() => {
        const region = dropRegion[0]();
        const view = session.viewState.paneDropView;
        if (!view) return;
        if (region === "left") {
          props.view.addLeft(view);
        }
        if (region === "right") {
          props.view.addRight(view);
        }
        if (region === "all") {
          props.view.replace(view);
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
