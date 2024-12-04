import { createSignal, Signal, useContext } from "solid-js";
import { DataView } from "../view/state";
import styles from "./list.module.css";
import XSVG from "../icons/x.svg?component-solid";
import { ListIcon } from "./list-icon";
import { sessionContext } from "../store/context";
import { NavItemContextMenu } from "../nav/context-menus";
import CheckSVG from "../icons/check.svg?component-solid";
import ArrowRightSVG from "../icons/arrow-right.svg?component-solid";

interface ListHeaderProps {
  container: SunlistContainer;
  view: DataView;
}

const KeyboardMarker = (props: { view: DataView }) => {
  const session = useContext(sessionContext);
  return (
    <div
      class={styles["keyboard-marker"]}
      style={`opacity: ${session.viewState.activePane[0]() == props.view ? "1" : "0"}`}
    >
      -
    </div>
  );
};

export const ListHeaderButton = (props: ListHeaderProps) => {
  let ref;
  const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  return (
    <>
      {ctxOpen() && (
        <NavItemContextMenu
          close={() => setCtxOpen(false)}
          container={ref}
          offset={ctxOffset()}
        />
      )}
      <button
        class={styles["list-head-button"]}
        tabIndex={-1}
        aria-expanded={ctxOpen()}
        ref={ref}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          setCtxOffset([event.clientX, event.clientY]);
          setCtxOpen(true);
        }}
      >
        <span style="padding-right: 0.5em;">
          <ListIcon container={props.container} />
        </span>
        <span class={styles["title-text"]}>{props.container.name}</span>
        <KeyboardMarker view={props.view} />
      </button>
    </>
  );
};

const CloseViewButton = (props: { view: DataView }) => {
  const session = useContext(sessionContext);
  return (
    <>
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
    </>
  );
};

export const ListHeader = (props: ListHeaderProps) => {
  return (
    <div class={styles["list-header"]}>
      <div class={styles["primary"]}>
        <ListHeaderButton container={props.container} view={props.view} />
        <CloseViewButton view={props.view} />
      </div>
      {/* <div class={styles["description"]}>Description</div> */}
    </div>
  );
};

export const DoneListHeader = (props: ListHeaderProps) => {
  return (
    <div class={styles["list-header"]}>
      <div class={styles["primary"]}>
        <button class={styles["list-head-button"]}>
          <CheckSVG
            style="width: 1.25em; height: 1.25em; stroke-width: 1.25px; color: var(--body-tint); position: relative;
            left: -3px; padding-right: 0.25em;"
          />
          <span>Done</span>
          <KeyboardMarker view={props.view} />
        </button>
        <CloseViewButton view={props.view} />
      </div>
      {/* <div class={styles["description"]}>Description</div> */}
    </div>
  );
};

export const UpNextHeader = (props: ListHeaderProps) => {
  return (
    <div class={styles["list-header"]}>
      <div class={styles["primary"]}>
        <button class={styles["list-head-button"]}>
          <ArrowRightSVG
            style="width: 1.25em; height: 1.25em; stroke-width: 1.25px; color: var(--body-tint); position: relative;
            left: -3px; padding-right: 0.25em;"
          />
          <span>Up Next</span>
          <KeyboardMarker view={props.view} />
        </button>
        <div
          style="display: flex;
          align-items: center;"
        >
          <button>Clear</button>
          <CloseViewButton view={props.view} />
        </div>
      </div>
      {/* <div class={styles["description"]}>Description</div> */}
    </div>
  );
};
