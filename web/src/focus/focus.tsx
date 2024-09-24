import styles from "./focus.module.css";
import { GenericItem } from "../store/loader";
import { viewState } from "../view/state";
import { glSnow } from "./ai-gl";
import { onMount } from "solid-js";

interface FocusProps {
  item: GenericItem;
}

// Full screen view with Pomodoro timer
// TODO: Change title of webpage to this
export const Focus = (props: FocusProps) => {
  let canvas: HTMLCanvasElement;
  // onMount(() => glSnow(canvas));
  return (
    <div class={styles["container"]}>
      <canvas ref={canvas} />
      <div class={styles["content"]}>
        <h1>{props.item.content}</h1>
        <button
          onClick={() => {
            viewState.scene[1]("default");
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
};
