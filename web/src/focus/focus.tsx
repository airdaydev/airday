import styles from "./focus.module.css";
import { GenericItem } from "../store/loader";
import { useContext } from "solid-js";
import { sessionContext } from "../store/context";
import { Key } from "../generic/key";

interface FocusProps {
  item: GenericItem;
}

// Full screen view with Pomodoro timer
// TODO: Change title of webpage to this
export const Focus = (props: FocusProps) => {
  const session = useContext(sessionContext);
  return (
    <div class={styles["container"]}>
      <div class={styles["content"]}>
        <h1>{props.item.content}</h1>
      </div>
      <button
        class={styles["focus-button"]}
        onClick={() => {
          session.viewState.scene[1]("default");
        }}
      >
        <Key key="Esc" />
        <span>Close</span>
      </button>
    </div>
  );
};
