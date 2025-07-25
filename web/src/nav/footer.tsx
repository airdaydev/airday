import { sessionContext } from "../store/context.js";
import { createSignal, useContext } from "solid-js";
import CloudOffSVG from "../icons/cloud-off.svg?component-solid";
import SearchSVG from "../icons/search.svg?component-solid";
import NewSVG from "../icons/plus.svg?component-solid";
import styles from "./footer.module.css";
import { ThemeToggle } from "../theme/theme";
import { AirContextMenu, WorkspaceContextMenu } from "./context-menus";
import { AccountButton } from "./account-button";
import { Key } from "../generic/key.jsx";
import { Screens } from "./screens.jsx";

type ContextMenu = "main" | "workspace";

export const Footer = () => {
  // ContextMenu
  const session = useContext(sessionContext);
  let appButtonRef;
  let workspaceButtonRef;
  const stats = () => {
    const focused = session.workspace.dndContext.focusContext[0]();
    if (!focused) return ``;
    const selectionSize = focused.selection[0]().size;
    const count = focused.treeState.count();
    if (selectionSize) return `${selectionSize}/${count}`;
    return `${count}`;
  };
  const selectedItems = () => {
    const focusedList = session.workspace.dndContext.focusContext[0]();
    if (!focusedList) return false;
    const selectionSize = focusedList.selection[0]().size;
    return !!selectionSize;
  };
  const [ctxOpen, setCtxOpen] = createSignal<ContextMenu | boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  function openContextMenu(
    event: MouseEvent,
    menu: ContextMenu,
    target?: HTMLElement,
  ) {
    event.preventDefault();
    if (!event.target && !target) return;
    if (event.target) {
      const bounds = target
        ? target.getBoundingClientRect()
        : event.target.getBoundingClientRect();
      setCtxOffset([bounds.left, document.body.clientHeight - bounds.top + 6]);
      setCtxOpen(menu);
    }
  }
  return (
    <footer class={styles.footer}>
      {ctxOpen() === "main" && (
        <AirContextMenu
          close={() => setCtxOpen(false)}
          offset={ctxOffset()}
          buttonRef={appButtonRef}
        />
      )}
      {ctxOpen() === "workspace" && (
        <WorkspaceContextMenu
          close={() => setCtxOpen(false)}
          offset={ctxOffset()}
          buttonRef={workspaceButtonRef}
        />
      )}
      <div class={styles["nav-section"]}>
        <button
          tabIndex={-1}
          ref={appButtonRef}
          class={styles["nav-button"]}
          onmouseup={(event) => {
            if (ctxOpen()) setCtxOpen(false);
            else openContextMenu(event, "main", appButtonRef);
          }}
          onMouseOver={(event) => {
            if (ctxOpen()) openContextMenu(event, "main");
          }}
        >
          <Key key="/" />
          <span style={"margin-left: 0.25em; display: none;"}>Air</span>
        </button>
        {/* <button
          tabIndex={-1}
          ref={workspaceButtonRef}
          class={`${styles["workspace-button"]} ${styles["nav-button"]}`}
          onmouseup={(event) => {
            if (ctxOpen()) setCtxOpen(false);
            else openContextMenu(event, "workspace", workspaceButtonRef);
          }}
          onMouseOver={(event) => {
            if (ctxOpen()) openContextMenu(event, "workspace");
          }}
        >
          Dev
        </button> */}
        <Screens />
      </div>
      <div class={styles["nav-section"]}>
        <span class={styles["count"]}>{stats()}</span>
        {/* {selectedItems() && (
        )} */}
        <button
          tabIndex={-1}
          class={styles["nav-button"]}
          style={"line-height: 0rem;"}
          onClick={() => {
            const activePane = session.viewState.activePane[0]();
            if (activePane.containerId) {
              // session.workspace.itemStore.insert(new )
            }
          }}
        >
          <NewSVG style="stroke-width: 2px;" />
        </button>
        <button
          tabIndex={-1}
          class={styles["nav-button"]}
          style={"line-height: 0rem;"}
        >
          <SearchSVG />
        </button>
        <ThemeToggle class={styles["nav-button"]} />
        <button
          tabIndex={-1}
          class={styles["nav-button"]}
          style={"line-height: 0rem;"}
        >
          <CloudOffSVG />
        </button>
      </div>
    </footer>
  );
};
