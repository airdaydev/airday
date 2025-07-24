import { useContext } from "solid-js";
import { Stickers } from "./stickers";
import styles from "./nav.module.css";
import NextIconSVG from "../icons/next-icon.svg?component-solid";
import PulseSVG from "../icons/pulse.svg?component-solid";
import CalendarSVG from "../icons/calendar.svg?component-solid";
import DoneSVG from "../icons/check-hand.svg?component-solid";
import TrashSVG from "../icons/bin-desaturated.png";
import { NavLists } from "./nav-lists";
import { sessionContext } from "../store/context";
import { AddListButton } from "./add-list";
import { MonthNav } from "../cal/month-nav";
import { SoloNode } from "@airday/list";
import { CalendarView, DoneView } from "../view/state";
import CaretSVG from "../icons/caret.svg?component-solid";

export function AirNav() {
  const session = useContext(sessionContext);
  const [sidebarVisible] = session.viewState.sidebarVisible;
  let ref: HTMLDivElement | undefined;
  const getMargin = () =>
    sidebarVisible()
      ? "0"
      : `-${ref ? ref.getBoundingClientRect().width - 10 : 0}px`;
  return (
    <nav
      class={styles.nav}
      ref={ref}
      style={{
        "margin-left": getMargin(),
      }}
      onClick={() => session.viewState.focusSidebar()}
    >
      {/* <MonthNav /> */}
      {/* <hr style="width: 100%; border: none; border-top: 1px solid var(--border); margin: 0;" /> */}
      <div
        class={`${styles["nav-list"]} ${styles["nav-text"]}`}
        style="padding-top: 0.5em;"
      >
        <button
          class={styles["nav-text-button"]}
          tabindex="-1"
          onClick={session.viewState.openUpNextView}
        >
          <NextIconSVG
            style="position: relative;
            width: 1.25em;
            stroke-width: 0.75px;
            left: 2px;
            height: 1.5em;
            color: var(--body-tint);"
          />
          <span>Next</span>
        </button>
        <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
        <SoloNode
          dndContext={session.workspace.containerStore.dndContext}
          enableDrop={false}
          Component={(props) => (
            <button
              class={styles["nav-text-button"]}
              style="display: flex; align-items: center; justify-content: space-between;"
              tabindex="-1"
              onClick={session.viewState.openCalendarView}
              onMouseDown={(event) => {
                session.viewState.paneDropView = new CalendarView(
                  session.viewState,
                );
                props.onMouseDown(event);
              }}
              ref={props.ref}
              selected={props.selected}
            >
              <div style="display: flex; align-items: center;">
                <CalendarSVG style="width: 1.25em; stroke-width: 1.5px;" />
                <span>Calendar</span>
              </div>
              <CaretSVG style="stroke-width: 2.5px; width: 7px; color: var(--body-tint);" />
            </button>
          )}
        />
      </div>
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <button class={styles["nav-text-header"]} tabindex="-1">
        <span>Private</span>
        <CaretSVG style="stroke-width: 2.5px; width: 7px;" />
      </button>
      <NavLists />
      <AddListButton />
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <button class={styles["nav-text-button"]} tabindex="-1">
        <PulseSVG style="width: 1.25em; stroke-width: 1.75px; color: var(--body-tint);" />
        <span>Performance</span>
      </button>
      <SoloNode
        dndContext={session.workspace.containerStore.dndContext}
        enableDrop={false}
        Component={(props) => (
          <button
            class={styles["nav-text-button"]}
            tabindex="-1"
            onClick={session.viewState.openDoneView}
            onMouseDown={(event) => {
              session.viewState.paneDropView = new DoneView(session.viewState);
              props.onMouseDown(event);
            }}
            ref={props.ref}
            selected={props.selected}
          >
            <DoneSVG style="width: 1.25em; stroke-width: 1.5px; color: var(--body-tint);" />
            <span>Done</span>
          </button>
        )}
      />
      <button class={styles["nav-text-button"]} tabindex="-1">
        <img
          src={TrashSVG}
          style="width: 1.25em; stroke-width: 1.5px; color: var(--body-tint);"
        />
        <span>Trash</span>
      </button>
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <Stickers />
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <button class={styles["nav-text-header"]} tabindex="-1">
        <span>Shared spaces</span>
        <CaretSVG style="stroke-width: 2.5px; width: 7px;" />
      </button>
    </nav>
  );
}
