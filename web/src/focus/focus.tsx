import styles from "./focus.module.css";
import { GenericItem } from "../store/loader";
import { viewState } from "../view-state";

interface FocusProps {
  item: GenericItem;
}

// Full screen view with Pomodoro timer
// TODO: Change title of webpage to this
export const Focus = (props: FocusProps) => {
  return (
    <div class={styles["container"]}>
      <div>
        <h2>{props.item.content}</h2>
        <div>03:00 of 15:00 left</div>
        <button
          onClick={() => {
            viewState.mode[1]("normal");
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
};
