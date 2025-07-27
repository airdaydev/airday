import styles from "./footer.module.css";
import NewSVG from "../icons/plus.svg?component-solid";
import ListIconTaskSVG from "../icons/list-icon-task.svg?component-solid";
import { useContext, For } from "solid-js";
import { sessionContext } from "../store/context";

export const WorkspaceSelector = () => {
  const session = useContext(sessionContext);
  return (
    <div class={styles["workspace-selector"]}>
      <For each={session.viewState.workspaces[0]()}>
        {(workspace, index) => (
          <button
            onClick={() => session.viewState.activeWorkspace[1](index())}
            classList={{
              [styles["workspace-button"]]: true,
              [styles["active"]]:
                index() === session.viewState.activeWorkspace[0](),
            }}
          >
            {/* TODO: Get from active view in workspace */}
            <ListIconTaskSVG />
          </button>
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
