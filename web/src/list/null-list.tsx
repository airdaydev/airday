import { Component } from "solid-js";
import { DataView } from "../view/state";
import styles from "./list.module.css";
import XSVG from "../icons/x.svg?component-solid";

interface NullListProps {
  view: DataView;
}

const NullList: Component<NullListProps> = (props) => {
  return (
    <div class={styles["list"]}>
      <div class={styles["list-header"]}>
        <div class={styles["primary"]}>
          <div>⚠️ Error: Null List</div>
          <button
            class={styles["list-button"]}
            onClick={() => props.view.detach()}
            tabIndex={-1}
          >
            <XSVG />
          </button>
        </div>
      </div>
    </div>
  );
};

export default NullList;
