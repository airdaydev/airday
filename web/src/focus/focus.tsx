import styles from "./focus.module.css";
import { GenericItem } from "../store/loader";
import { useContext } from "solid-js";
import { sessionContext } from "../store/context";
import { Key } from "../generic/key";
import { ThrottleButton } from "./throttle-button";

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
      <ThrottleButton
        action={() => session.viewState.openDefaultScene()}
        key={"Escape"}
      >
        <Key key="esc" />
        <span>End</span>
      </ThrottleButton>
    </div>
  );
};
