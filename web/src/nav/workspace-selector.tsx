import styles from "./footer.module.css";
import NewSVG from "../icons/plus.svg?component-solid";
import ListIconTaskSVG from "../icons/list-icon-task.svg?component-solid";
import XSVG from "../icons/x.svg?component-solid";
import { useContext, For } from "solid-js";
import { sessionContext } from "../store/context";

export const WorkspaceSelector = () => {
  const session = useContext(sessionContext);
  return (
    <div class={styles["workspace-selector"]}>
      <For each={session.viewState.workspaces[0]()}>
        {(workspace, index) => (
          <div
            class={styles["workspace-button-container"]}
            classList={{
              [styles["active"]]:
                index() === session.viewState.activeWorkspace[0](),
            }}
          >
            <button
              onClick={() => session.viewState.activeWorkspace[1](index())}
              class={styles["workspace-button"]}
            >
              {/* TODO: Get from active view in workspace */}
              <ListIconTaskSVG />
              <span class={styles["workspace-text"]}>2 tabs</span>
            </button>
            <button
              class={styles["workspace-close"]}
              onClick={() => session.viewState.closeActiveWorskpace()}
            >
              <XSVG style="width: 0.75em;" />
            </button>
          </div>
        )}
      </For>
      <button
        class={styles["nav-button"]}
        style="width: 2em; display: flex; justify-content:center; margin-left: 0.25em; color: var(--body-tint);"
        onClick={() => session.viewState.addWorkspace()}
      >
        <NewSVG style="stroke-width: 2px;" />
      </button>
    </div>
  );
};
