import { For, useContext } from "solid-js";
import styles from "./view.module.css";
import { sessionContext } from "../store/context.js";
import { List } from "../list/list";
import { viewContext, viewState } from "./state";
import { PaneDropGuide } from "./pane-drop-guide";

interface ViewProps {
  view: BordeView;
  tabId: number;
}

/**
 * Unwraps view object and ensures corresponding view created
 */
export function View(props: ViewProps) {
  // Type checking
  return (
    <viewContext.Provider value={viewState}>
      <List view={props.view} tabId={props.tabId} />
    </viewContext.Provider>
  );
}

export function PaneRegion() {
  const session = useContext(sessionContext);
  return (
    <div class={styles["pane-region"]}>
      <For
        each={viewState.tree.children[0]()}
        fallback={<div>View Matrix</div>}
      >
        {(column, colIndex) => (
          <div class={styles.column}>
            <For
              each={viewState.tree.children[0]()}
              fallback={<div>Col {colIndex}</div>}
            >
              {(view, rowIndex) => {
                return (
                  <div class={styles["view-cell"]}>
                    {session.workspace.containerModel.dndContext.isDragging() && (
                      <PaneDropGuide
                        view={view}
                        yikes={/*TODO: Clean Up Below */ true}
                        container={session.workspace.containerModel.dndContext.listContexts
                          .values()
                          .next()
                          .value.getFirstSelected()}
                      />
                    )}
                    <View view={view} tabId={rowIndex()} />
                  </div>
                );
              }}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
