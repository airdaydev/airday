import { sessionContext } from "../store/context.js";
import { createSignal, useContext } from "solid-js";
import CloudOffSVG from "../icons/cloud-off.svg?component-solid";
import SearchSVG from "../icons/pixel-search.svg?component-solid";
import SidebarSVG from "../icons/rainbow.svg?component-solid";
import styles from "./footer.module.css";
import { ThemeToggle } from "../theme/theme";
import { BordeContextMenu, WorkspaceContextMenu } from "./context-menus";
import { AccountButton } from "./account-button";

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
        <BordeContextMenu
          close={() => setCtxOpen(false)}
          offset={ctxOffset()}
        />
      )}
      {ctxOpen() === "workspace" && (
        <WorkspaceContextMenu
          close={() => setCtxOpen(false)}
          offset={ctxOffset()}
        />
      )}
      <div class={styles["nav-section"]}>
        <button
          ref={appButtonRef}
          class={styles["nav-button"]}
          onClick={(event) => openContextMenu(event, "main", appButtonRef)}
          onMouseOver={(event) => {
            if (ctxOpen()) openContextMenu(event, "main");
          }}
        >
          <SidebarSVG />
          <span style={"margin-left: 0.25em; display: none;"}>SunList</span>
        </button>
        <button
          ref={workspaceButtonRef}
          class={`${styles["workspace-button"]} ${styles["nav-button"]}`}
          onClick={(event) =>
            openContextMenu(event, "workspace", workspaceButtonRef)
          }
          onMouseOver={(event) => {
            if (ctxOpen()) openContextMenu(event, "workspace");
          }}
        >
          {session.workspace.name}
        </button>
        <button class={styles["nav-button"]} style={"line-height: 0rem;"}>
          <span class={styles["key"]}>⌘</span>
          <span class={styles["key"]}>/</span>
          Cmd
        </button>
      </div>
      <div class={styles["nav-section"]}>
        <span class={styles["count"]}>{stats()}</span>
        {selectedItems() && (
          <button class={styles["nav-button"]} style={"line-height: 0rem;"}>
            <span class={styles["key"]}>F</span>
            Focus
          </button>
        )}
        <button class={styles["nav-button"]} style={"line-height: 0rem;"}>
          <span class={styles["key"]}>N</span>
          New
        </button>
        <button class={styles["nav-button"]} style={"line-height: 0rem;"}>
          <span class={styles["key"]}>/</span>
          Find
        </button>
        <ThemeToggle class={styles["nav-button"]} />
        <button class={styles["nav-button"]} style={"line-height: 0rem;"}>
          <CloudOffSVG />
        </button>
        <button
          class={styles["nav-button"]}
          style="background: #5937ff; color: white; line-height: 1.25rem;"
        >
          Sync AUD$4 monthly
        </button>
      </div>
    </footer>
  );
};
