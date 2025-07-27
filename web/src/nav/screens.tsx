import styles from "./footer.module.css";
import NewSVG from "../icons/plus.svg?component-solid";
import ListIconTaskSVG from "../icons/list-icon-task.svg?component-solid";
import CalendarSVG from "../icons/calendar.svg?component-solid";

export const Screens = () => {
  return (
    <div class={styles["screens"]}>
      {/* <button class={styles["screen-button"]}>
        <CalendarSVG />
      </button> */}
      <button
        classList={{
          [styles["screen-button"]]: true,
          [styles["active"]]: true,
        }}
      >
        <ListIconTaskSVG />
      </button>
      <button
        class={styles["nav-button"]}
        style="width: 2em; display: flex; justify-content:center; margin-left: 0.25em; color: var(--body-tint);"
      >
        <NewSVG style="stroke-width: 2px;" />
      </button>
    </div>
  );
};
