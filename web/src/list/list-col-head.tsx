import CheckSVG from "../icons/check.svg?component-solid";
import styles from "./list.module.css";

export const ListColumnHeaders = () => {
  return (
    <div class={styles["list-col-head"]}>
      <span style={`width: 1rem;`} class={styles["list-col-head-item"]}>
        <CheckSVG />
      </span>
      <span
        class={styles["list-col-head-item"]}
        style="position: relative;
        top: 1px;
        width: 1em;
        stroke-width: 2px;"
      >
        Az
      </span>
      <span class={styles["list-col-head-item"]} style={`width: 4em;`}>
        Date
      </span>
    </div>
  );
};
