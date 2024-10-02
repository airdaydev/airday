import { createSignal, Signal, useContext } from "solid-js";
import { DataView } from "../view/state";
import styles from "./list.module.css";
import XSVG from "../icons/x.svg?component-solid";
import { ListIcon } from "./list-icon";
import { sessionContext } from "../store/context";
import { NavItemContextMenu } from "../nav/context-menus";

interface ListHeaderProps {
  container: Signal<SunlistContainer>;
  tabId: number;
  view: DataView;
}

export const ListHeader = (props: ListHeaderProps) => {
  const session = useContext(sessionContext);
  let ref;
  const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  return (
    <div class={styles["list-header"]}>
      <div class={styles["primary"]}>
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
          <div
            class={styles["keyboard-marker"]}
            style={`opacity: ${session.viewState.activePane[0]() == props.view ? "1" : "0"}`}
          >
            •
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
      {/* <div class={styles["description"]}>Description</div> */}
    </div>
  );
};
