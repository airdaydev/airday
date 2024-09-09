import { sessionContext } from "../store/context.js";
import { createSignal, useContext } from "solid-js";
import CloudOffSVG from "../icons/cloud-off.svg?component-solid";
import SearchSVG from "../icons/search.svg?component-solid";
import styles from "./footer.module.css";
import { ThemeToggle } from "../theme/theme";
import { BordeContextMenu, WorkspaceContextMenu } from "./context-menus";
import { AccountButton } from "./account-button";

type ContextMenu = "main" | "workspace";

export const Footer = () => {
  // ContextMenu
  const session = useContext(sessionContext);
  const [ctxOpen, setCtxOpen] = createSignal<ContextMenu | boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  function openContextMenu(event: MouseEvent, menu: ContextMenu) {
    event.preventDefault();
    if (event.target) {
      const bounds = event.target.getBoundingClientRect();
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
          class={styles["nav-button"]}
          onClick={(event) => openContextMenu(event, "main")}
          onMouseOver={(event) => {
            if (ctxOpen()) openContextMenu(event, "main");
          }}
        >
          Circa
        </button>
        <button
          class={`${styles["workspace-button"]} ${styles["nav-button"]}`}
          onClick={(event) => openContextMenu(event, "workspace")}
          onMouseOver={(event) => {
            if (ctxOpen()) openContextMenu(event, "workspace");
          }}
        >
          {session.workspace.name}
        </button>
      </div>
      <div class={styles["nav-section"]}>
        <span>0 items (0 selected)</span>
        <ThemeToggle class={styles["nav-button"]} />
        <button class={styles["nav-button"]}>
          <SearchSVG />
        </button>
        <button class={styles["nav-button"]}>
          <CloudOffSVG />
        </button>
      </div>
    </footer>
  );
};
