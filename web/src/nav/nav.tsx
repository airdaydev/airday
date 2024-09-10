import { Accessor } from "solid-js";
import { Stickers } from "./stickers";
import styles from "./nav.module.css";
import { viewState } from "../view/state";
import NextSVG from "../icons/next.svg?component-solid";
import PerformanceSVG from "../icons/activity.svg?component-solid";
import CalendarSVG from "../icons/calendar.svg?component-solid";
import CheckSVG from "../icons/check.svg?component-solid";
import TrashSVG from "../icons/trash.svg?component-solid";
import { NavLists } from "./nav-lists";

export function BordeNav() {
  const [sidebarVisible] = viewState.sidebarVisible;
  let ref: HTMLDivElement | undefined = undefined;
  const getMargin = () =>
    sidebarVisible()
      ? "0"
      : `-${ref ? ref.getBoundingClientRect().width : 0}px`;
  return (
    <nav
      class={styles.nav}
      ref={ref}
      style={{
        "margin-left": getMargin(),
      }}
    >
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border); margin: 0;" />
      <div
        class={`${styles["nav-list"]} ${styles["nav-text"]}`}
        style="padding-top: 0.5em;"
      >
        <button class={styles["nav-text-button"]}>
          <NextSVG
            style="position: relative;
            width: 1.25em;
            stroke-width: 0.75px;
            left: 2px;
            height: 1.5em;
            color: var(--body-tint);"
          />
          <span>Priority</span>
        </button>
        <button class={styles["nav-text-button"]}>
          <CalendarSVG style="width: 1.25em; stroke-width: 1.5px; color: var(--body-tint);" />
          <span>Calendar</span>
        </button>
        <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
        <button class={styles["nav-text-button"]}>
          <PerformanceSVG style="width: 1.25em; stroke-width: 1.5px; color: var(--body-tint);" />
          <span>Performance</span>
        </button>
        <button
          onClick={viewState.openDoneView}
          class={styles["nav-text-button"]}
        >
          <CheckSVG style="width: 1.25em; stroke-width: 1.25px; color: var(--body-tint);" />
          <span>Done</span>
        </button>
      </div>
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <NavLists />
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <Stickers />
      <div style="color: #81777f; border: none; background: none; cursor: pointer; padding: 0.5em; outline: 0; font-family: inherit; font-size: 1rem;">
        Add stickers
      </div>
      {/* <button>
        <CalendarSVG style="width: 1.25em; stroke-width: 1.25px;" />
        <span>Scheduled</span>
      </button>
      <button onClick={viewState.openDoneView}>
        <TrashSVG style="width: 1.25em; stroke-width: 1.25px;" />
        <span>Trash</span>
      </button> */}
    </nav>
  );
}
