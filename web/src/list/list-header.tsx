import { Signal } from "solid-js";
import { viewState } from "../view-state";
import { EditableListTitle } from "./list-title";
import styles from "./list.module.css";
import XSVG from "../icons/x.svg?component-solid";
import { ListIcon } from "./list-icon";

interface ListHeaderProps {
  container: Signal<BordeContainer>;
  tabId: number;
}

export const ListHeader = (props: ListHeaderProps) => {
  const [list] = viewState.list;
  return (
    <div class={styles["list-header"]}>
      <div style={`display: flex; align-items: center; padding: 0.25em;`}>
        <span style="padding-right: 0.5em;">
          <ListIcon container={props.container} />
        </span>
        <span class={styles["title-text"]}>{props.container.name}</span>
      </div>
      {list().length > 1 && (
        <div>
          <button
            class={styles["list-button"]}
            onClick={() => viewState.closeView(props.tabId)}
          >
            <XSVG />
          </button>
        </div>
      )}
    </div>
  );
};
