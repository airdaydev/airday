import { Signal } from "solid-js";
import { DataView, viewState } from "../view/state";
import { EditableListTitle } from "./list-title";
import styles from "./list.module.css";
import XSVG from "../icons/x.svg?component-solid";
import { ListIcon } from "./list-icon";

interface ListHeaderProps {
  container: Signal<SunlistContainer>;
  tabId: number;
  view: DataView;
}

// ⌨
export const ListHeader = (props: ListHeaderProps) => {
  return (
    <div class={styles["list-header"]}>
      <button class={styles["list-head-button"]} tabIndex={-1}>
        <span style="padding-right: 0.5em;">
          <ListIcon container={props.container} />
        </span>
        <span class={styles["title-text"]}>{props.container.name}</span>
        <div
          class={styles["keyboard-marker"]}
          style={`opacity: ${viewState.activePane[0]() == props.view ? "1" : "0"}`}
        >
          -
        </div>
      </button>
      {viewState.count() > 1 && (
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
