import { Signal, useContext } from "solid-js";
import { DataView } from "../view/state";
import styles from "./list.module.css";
import XSVG from "../icons/x.svg?component-solid";
import { ListIcon } from "./list-icon";
import { sessionContext } from "../store/context";

interface ListHeaderProps {
  container: Signal<SunlistContainer>;
  tabId: number;
  view: DataView;
}

// ⌨
export const ListHeader = (props: ListHeaderProps) => {
  const session = useContext(sessionContext);
  return (
    <div class={styles["list-header"]}>
      <button class={styles["list-head-button"]} tabIndex={-1}>
        <span style="padding-right: 0.5em;">
          <ListIcon container={props.container} />
        </span>
        <span class={styles["title-text"]}>{props.container.name}</span>
        <div
          class={styles["keyboard-marker"]}
          style={`opacity: ${session.viewState.activePane[0]() == props.view ? "1" : "0"}`}
        >
          -
        </div>
      </button>
      {session.viewState.count() > 1 && (
        <div>
          <button
            class={styles["list-button"]}
            onClick={() => props.view.detach()}
            tabIndex={-1}
          >
            <XSVG />
          </button>
        </div>
      )}
    </div>
  );
};
