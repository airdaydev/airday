import { For, Match, Switch, useContext } from "solid-js";
import styles from "./view.module.css";
import { sessionContext } from "../store/context.js";
import { Views } from "./state";
import { PaneDropGuide } from "./pane-drop-guide";
import { DataViewComponent } from "./data-view";

/**
 * Unwraps view object and ensures corresponding view created
 * TODO: This has been simplified down from previous 4 way split but rushed, still
 * some ugly code going on
 */
export function View(props: { views: Views }) {
  const session = useContext(sessionContext);
  return (
    <div class={styles["pane-region"]}>
      <For
        each={props.views.children[0]()}
        fallback={<div>Empty View / loading</div>}
      >
        {(view, index) => (
          <Switch>
            <Match when={view.type === "data"}>
              <div class={styles["view-cell"]}>
                {session.library.containerStore.dndContext.isDragging() && (
                  <PaneDropGuide view={view} />
                )}
                <DataViewComponent view={view} />
              </div>
            </Match>
            <Match when={view.type === "container"}>
              <div class={styles["horizontal-container"]}>
                <View view={view} />
              </div>
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
