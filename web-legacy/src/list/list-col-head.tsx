import CheckSVG from "../icons/check.svg?component-solid";
import styles from "./list.module.css";

export const ListColumnHeaders = () => {
  return (
    <div class={styles["list-col-head"]}>
      <span
        class={styles["list-col-head-item"]}
        style="position: relative;
        width: 1em;"
      >
        Item
      </span>
      <span class={styles["list-col-head-item"]} style={`margin-left: auto;`}>
        Date
      </span>
    </div>
  );
};
